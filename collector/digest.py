#!/usr/bin/env python3
"""내 지역 주간 기록 메일.

/my 에서 시도·시군구를 고르고 메일 주소를 넣은 사람에게, 지난주(월~일, KST)에 **새로 수집된**
그 지역 현직의 공개 기록을 보낸다 — 대표발의 법안, 본회의 표결(결과별 건수), 본회의 출결 누적,
공약 판정의 변화(이전 → 지금). '새로' 는 사건 날짜가 아니라 수집된 때다(bill·vote·attendance.created_at,
판정 이력 pledge_status_log). 국회 API 가 며칠 늦게 주는 기록도 빠지지 않고, 주와 주가 겹치지 않는다.

- 한 사람에게 한 주 한 통: digest_log (구독자, 주) 기본키. 매일 돌려도 된다(digest.yml).
- 기록이 없는 주는 보내지 않는다(digest_log 에 sent=false 로만 남는다).
- 메일 한도(Resend 429)에 걸리면 깨끗이 멈춘다. 남은 사람은 다음 날 실행이 잇는다.
- 문구는 기록을 옮기기만 한다. 평가하는 말을 넣지 않는다(test_digest 가 막는다).

    python digest.py                              # 이번 주 메일을 보낸다
    python digest.py --preview 대구광역시 서구      # 다음 월요일 메일(지금까지 모인 것)을 찍기만 한다

환경변수: DATABASE_URL, RESEND_API_KEY, MAIL_FROM (--preview 는 DATABASE_URL 만)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
import psycopg

KST = ZoneInfo("Asia/Seoul")
SITE = "https://nureongso.joon.is-a.dev"
FROM = os.getenv("MAIL_FROM")
RESEND = "https://api.resend.com/emails"
OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"]  # /my 와 같은 순서
VOTE_ORDER = ["찬성", "반대", "기권", "불참"]
DECIDED_BY = {"auto": "자동 판정", "reviewer": "검수"}
# 한 사람·한 종류에 이만큼만 적고 나머지는 '외 N건'. 재적재로 수백 건이 한꺼번에 '새로' 잡혀도 메일이 터지지 않게.
CAP = 10


def week_of(now: datetime) -> date:
    """now 가 속한 주의 월요일(KST). 이 주에 보내는 메일의 열쇠(digest_log.week)다."""
    d = now.astimezone(KST).date()
    return d - timedelta(days=d.weekday())


def window(week: date) -> tuple[datetime, datetime]:
    """week 에 보내는 메일이 담는 기간: 지난주 월 00:00 ~ 이번 주 월 00:00 (KST, 끝은 미포함)."""
    end = datetime.combine(week, datetime.min.time(), KST)
    return end - timedelta(days=7), end


# 아래 셋은 web/src/lib/area.ts 의 sido 와 web/src/app/my/page.tsx 의 picked·inDistrict 와 같은 규칙이다.
# 한쪽을 고치면 다른 쪽도(party_line / partyLine 처럼).
SD_MERGED = {"광주광역시": "전남광주통합특별시", "전라남도": "전남광주통합특별시"}


def sido(v: str | None) -> str:
    return SD_MERGED.get(v, v) if v else ""


def in_district(district: str, wiw: str) -> bool:
    """'전북 군산시김제시부안군을' 에 '김제시' 가 있나. 시군구 이름이 시작하는 자리에서만 센다
    — 그냥 포함이면 '서구' 가 달서구·강서구에, '양주시' 가 남양주시에 붙는다."""
    i = district.find(wiw)
    while i >= 0:
        if i == 0 or district[i - 1] in " 시군구":
            return True
        i = district.find(wiw, i + 1)
    return False


def resolve(rows, sd: str, wiw: str) -> list[tuple[str, str, str]]:
    """그 지역의 현직 (code, name, office). rows 는 (code, office, sd_name, wiw_name, district, name)."""
    out = []
    for code, office, sd_name, wiw_name, district, name in rows:
        if not sd_name or sd_name == "전국" or sido(sd_name) != sd:
            continue
        # 구시군의장은 시군구가 곧 관할, 국회의원은 지역구 이름 경계에서 잇는다. 시도지사·교육감은 시도 전체.
        if wiw and office == "구시군의장" and wiw_name != wiw:
            continue
        if wiw and office == "국회의원" and not in_district(district or "", wiw):
            continue
        out.append((code, name, office))
    rank = {o: i for i, o in enumerate(OFFICE_ORDER)}
    return sorted(out, key=lambda p: (rank.get(p[2], len(rank)), p[1]))


def render(area: str, people, changes, start: datetime, end: datetime, token: str) -> tuple[str, str] | None:
    """(제목, 본문). 기록이 하나도 없으면 None — 보내지 않는다."""
    by: dict = defaultdict(lambda: defaultdict(list))
    for code, kind, data in changes:
        by[code][kind].append(data)
    blocks = []
    for code, name, office in people:
        k = by.get(code)
        if not k:
            continue
        lines = []
        bills = sorted(k["bill"], key=lambda b: (b["proposed_at"] or "", b["bill_id"]))
        for b in bills[:CAP]:
            when = f" ({b['proposed_at']})" if b["proposed_at"] else ""
            lines.append(f"- 대표발의 {b['name']}{when}\n  {SITE}/bill/{b['bill_id']}")
        if len(bills) > CAP:
            lines.append(f"- 대표발의 외 {len(bills) - CAP}건")
        if k["vote"]:
            n = {v["result"]: v["n"] for v in k["vote"]}
            order = VOTE_ORDER + sorted(set(n) - set(VOTE_ORDER))
            lines.append(f"- 본회의 표결 {sum(n.values())}건: " + " · ".join(f"{r} {n.get(r, 0)}" for r in order))
        for a in k["attendance"]:
            lines.append(f"- 본회의 출결 제{a['age']}대 제{a['session_no']}회까지 누적: "
                         f"출석 {a['present']} / 회의일수 {a['days']}")
        pledges = sorted(k["pledge"], key=lambda p: (p["order_no"] or 0, p["pledge_id"]))
        for p in pledges[:CAP]:
            who = DECIDED_BY.get(p["decided_by"], p["decided_by"])
            # 판정 이력에서 상태가 바뀐 줄(digest_changes). 왜 바뀌었는지는 공약 상세에 있다.
            lines.append(f"- 공약 판정 「{p['title']}」 {p['prev']} → {p['status']} ({who})\n"
                         f"  {SITE}/pledge/{p['pledge_id']}")
        if len(pledges) > CAP:
            lines.append(f"- 공약 판정 외 {len(pledges) - CAP}건")
        blocks.append(f"■ {name} ({office})  {SITE}/m/{code}\n" + "\n".join(lines))
    if not blocks:
        return None
    last = end - timedelta(days=1)
    subject = f"[누렁소검은소] {area} 주간 기록 {start:%m.%d}~{last:%m.%d}"
    text = "\n\n".join([
        f"{area} — {start:%Y-%m-%d} ~ {last:%Y-%m-%d} 에 새로 수집된 공개 기록입니다.",
        *blocks,
        f"기관이 공개한 기록을 옮긴 것이며 평가를 담지 않습니다. 세는 방법: {SITE}/rules",
        f"구독 해지: {SITE}/subscription?do=stop&t={token}",
    ])
    return subject, text


class Quota(Exception):
    """메일 서비스 한도(429: 초당·하루·달). 그날은 멈추고 다음 실행에 맡긴다 — 재시도하지 않는다."""


def send(client: httpx.Client, to: str, subject: str, text: str, unsub: str, key: str) -> None:
    r = client.post(RESEND, headers={"Idempotency-Key": key}, json={
        "from": FROM, "to": [to], "subject": subject, "text": text,
        # 메일 앱의 '구독 해지' 단추가 바로 해지하게 한다(RFC 8058, POST). 본문 링크는 확인 화면을 거친다.
        "headers": {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
    })
    if r.status_code == 429:
        raise Quota(r.text[:200])
    r.raise_for_status()


AREA_SQL = """
select a.member_code, a.office, a.sd_name, a.wiw_name, m.district, m.name
from member_area a join member m on m.code = a.member_code
"""


def changes_of(cur, people, start: datetime, end: datetime) -> list[tuple]:
    if not people:
        return []
    cur.execute("select member_code, kind, data from digest_changes(%s, %s, %s)",
                ([c for c, _, _ in people], start, end))
    return cur.fetchall()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--preview", nargs="+", metavar="지역",
                   help="'시도 [시군구]' 의 다음 월요일 메일(지금까지 모인 것)을 찍기만 한다")
    a = p.parse_args()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다. .env 를 확인하세요.")
    week = week_of(datetime.now(KST))

    if a.preview:
        sd, wiw = a.preview[0], " ".join(a.preview[1:])
        start, end = window(week + timedelta(days=7))
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(AREA_SQL)
            people = resolve(cur.fetchall(), sd, wiw)
            mail = render(" ".join(filter(None, [sd, wiw])), people,
                          changes_of(cur, people, start, end), start, end, "TOKEN")
        print(f"{len(people)}명: {', '.join(f'{n}({o})' for _, n, o in people)}")
        print(f"Subject: {mail[0]}\n\n{mail[1]}" if mail else "이 기간 새 기록 없음 — 보내지 않는다")
        return

    key = os.environ.get("RESEND_API_KEY")
    # 켜기 전(운영 DB 적용·Resend 도메인 확인 전)에는 꺼져 있다. 매일 빨간불이 뜨지 않게 0 으로 끝낸다.
    # 웹 구독 폼도 같은 키가 없으면 안 뜬다(web/src/lib/subscription.ts subscriptionOn).
    if not (key and FROM):
        print("[digest] RESEND_API_KEY·MAIL_FROM 이 없어 건너뜁니다(주간 메일 꺼짐)", file=sys.stderr)
        return
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("select to_regclass('public.subscriber') is not null")
        if not cur.fetchone()[0]:
            print("[digest] subscriber 표가 없어 건너뜁니다(schema.sql '주간 기록 메일' 적용 전)", file=sys.stderr)
            return
    start, end = window(week)
    sent = empty = failed = 0
    with psycopg.connect(dsn) as conn, \
            httpx.Client(timeout=30, headers={"Authorization": f"Bearer {key}"}) as client:
        with conn.cursor() as cur:
            # 확인하지 않은 주소는 7일 뒤 지운다. 확인 링크도 그때 끊긴다(subscription_confirm).
            cur.execute("delete from subscriber where confirmed_at is null"
                        " and coalesce(confirm_sent_at, created_at) < now() - interval '7 days'")
            cur.execute(AREA_SQL)
            areas = cur.fetchall()
            cur.execute("select id, email, sd_name, wiw_name, token from digest_due(%s)", (week,))
            due = cur.fetchall()
        conn.commit()

        made: dict[tuple[str, str], tuple] = {}  # 같은 지역 구독자는 한 번만 센다
        for sid, email, sd, wiw, token in due:
            if (sd, wiw) not in made:
                people = resolve(areas, sd, wiw)
                with conn.cursor() as cur:
                    made[(sd, wiw)] = (people, changes_of(cur, people, start, end))
            people, changes = made[(sd, wiw)]
            mail = render(" ".join(filter(None, [sd, wiw])), people, changes, start, end, str(token))
            with conn.cursor() as cur:
                # 먼저 '처리함' 을 적고 보낸다. 겹친 실행이 있어도 한쪽만 적힌다(기본키).
                cur.execute("insert into digest_log (subscriber_id, week, sent) values (%s, %s, %s)"
                            " on conflict do nothing returning 1", (sid, week, mail is not None))
                claimed = cur.fetchone()
            conn.commit()
            if not claimed:
                continue
            if not mail:
                empty += 1
                continue
            try:
                send(client, email, *mail, f"{SITE}/api/subscription?do=stop&t={token}", f"digest-{week}-{sid}")
                sent += 1
            except (Quota, httpx.HTTPError) as e:
                # 못 보냈으면 적은 것을 지워 다음 실행이 다시 집게 한다.
                with conn.cursor() as cur:
                    cur.execute("delete from digest_log where subscriber_id = %s and week = %s", (sid, week))
                conn.commit()
                if isinstance(e, Quota):
                    print(f"[digest] 메일 한도: {e} — 남은 사람은 다음 실행이 잇는다", file=sys.stderr)
                    break
                print(f"[digest] ! {sid}: {e}", file=sys.stderr)
                failed += 1
            time.sleep(0.2)  # Resend 기본 한도 초당 10건
    print(f"[digest] {week} 주 · 보냄 {sent} · 기록 없음 {empty} · 실패 {failed} · 대상 {len(due)}",
          file=sys.stderr)
    # 성공한 것은 이미 적혔다. 그래도 초록불로 끝내면 못 받은 사람을 아무도 모른다.
    if failed:
        sys.exit(f"{failed}명에게 보내지 못했습니다. 다음 실행이 다시 시도합니다.")


if __name__ == "__main__":
    main()

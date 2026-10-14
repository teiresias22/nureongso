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

import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

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
                         f"  {SITE}/pledge/{p['pledge_id']}")  # 검토: 구현은 「…」 {prev} → {status} ({who}) + /pledge/{id} 줄
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

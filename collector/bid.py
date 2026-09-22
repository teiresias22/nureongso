#!/usr/bin/env python3
"""나라장터 공사 입찰공고 수집기 — 예산사업형 공약에 붙일 '발주됐다' 는 사실.

예산사업형이 공약의 가장 큰 덩어리인데(현직 7,285건) 여태 잴 수단이 없었다.
발주는 예산 편성보다 강한 근거다. 편성은 '하겠다' 고 적어 둔 것이고, 발주는
업체를 부르는 공고를 실제로 냈다는 뜻이다.

사용:
    python bid.py fetch                      # 취임일(2026-07-01) 이후
    python bid.py fetch --since 20260701 --until 20260930
    python bid.py fetch --min 300000000      # 3억 이상만

환경변수: DATABASE_URL, DATA_GO_KR_KEY
    data.go.kr > 조달청_나라장터 입찰공고정보서비스(15129394) 활용신청(자동승인).
    선관위 API 와 같은 키를 쓴다. 서비스마다 따로 신청해야 열린다 — 신청 전에는
    키가 맞아도 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다(실측).

주의: 발주 기록은 '그 사업이 진행됐다' 는 사실이지 '이 사람이 해냈다' 가 아니다.
국회의원에게는 예산 편성권이 없고, 단체장 공약도 전임자가 이미 추진하던 사업일 수
있다. 그래서 판정에서 이 근거는 '완료' 를 만들지 않는다 — judge.py 를 보라.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time

import httpx
import psycopg
from urllib.parse import unquote

from ingest import d, upsert
from judge import SIDO_ALIAS, ordin_org

URL = ("https://apis.data.go.kr/1230000/ad/BidPublicInfoService"
       "/getBidPblancListInfoCnstwk")
# 포털은 인코딩 키와 디코딩 키를 둘 다 보여준다. httpx 가 params 를 다시 인코딩하므로
# 인코딩 키를 그대로 주면 이중 인코딩돼 키가 틀렸다는 오류가 난다 (nec.py 와 같다).
KEY = os.getenv("DATA_GO_KR_KEY") or None
if KEY and "%" in KEY:
    KEY = unquote(KEY)

PAGE = 999          # numOfRows 상한 (실측: 999 까지 받는다)
TERM_START = "20260701"

# 예산 하한. 낮추면 '은행나무 열매채취공사 4,100만원' 같은 것이 들어온다. 공약의
# 근거가 될 일이 없는 데다 이름이 짧아 유사도 매칭에 잡음만 키운다.
#
# ponytail: 용량 때문이기도 하다. 하한 없이 전국 지자체 공사를 다 받으면 4년에
# 27만 행이고, 1억 이상이면 14만 행이다(실측 추산). 예전에 지방재정365 한 해치
# 163MB 로 무료 500MB 를 거의 다 먹은 적이 있어 이번엔 처음부터 잘라 둔다.
# 더 줄여야 하면 --min 을 올리거나 지난 임기 행을 지운다.
MIN_BUDGET = 100_000_000


# 한 건짜리 공사 예산의 상식 밖 상한. 원본이 깨진 값을 준다 — 실측: 하동군
# '지례천(화촌지구) 일반하천 정비사업' 의 bdgtAmt 가 12240000012240000011 (20자리)
# 로 왔다. 같은 숫자가 두 번 이어붙은 꼴이고, 같은 행의 추정가격은 1.1억이다.
# 그대로 넣으면 bigint 범위를 넘겨 수집이 통째로 멈춘다.
SANE_MAX = 10**13          # 10조


def num(v) -> int | None:
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= SANE_MAX else None


def tracked_orgs(cur) -> list[str]:
    """우리가 다루는 지자체의 '기관명'. 나라장터 수요기관명이 법제처 자치법규의
    지자체기관명과 같은 형식이라('충청남도 아산시') ordin_org 를 그대로 쓴다.

    긴 이름부터 돌려준다 — owner_of 가 가장 긴 것부터 맞춰 봐야 하기 때문이다.
    """
    cur.execute(
        "select a.office, a.sd_name,"
        " (select c.district from candidacy c where c.member_code = a.member_code"
        "   and c.elected and c.office = a.office"
        "   order by c.election_id desc limit 1)"
        " from member_area a where a.office <> '국회의원'")
    orgs = {ordin_org(o, sd, dist or "") for o, sd, dist in cur.fetchall()}
    return sorted(orgs, key=len, reverse=True)


def owner_of(name: str | None, orgs: list[str]) -> str | None:
    """기관명을 그 사업의 주인 지자체로 옮긴다.

    큰 공사일수록 본청이 아니라 산하 본부 이름으로 나간다. 실측: 인천광역시는
    1억 이상 공사가 한 건도 없는 것으로 잡혔는데, 실제로는 '인천광역시
    도시철도건설본부' 가 7호선 청라 연장 궤도공사 374억을, '인천광역시
    종합건설본부' 가 버스공영차고지 72억을 발주하고 있었다. 정확히 일치만 보면
    시도지사 공약에 딱 맞는 사업을 통째로 버린다.

    **가장 긴 것부터** 맞춘다. '서울특별시 강남구 도시관리공단' 은 '서울특별시'
    로도 시작하지만 주인은 강남구청장이지 서울시장이 아니다.
    """
    if not name:
        return None
    for org in orgs:                       # 긴 이름 우선
        if name == org or name.startswith(org + " "):
            return org
    return None


def split_district(district: str, vocab: list[str]) -> list[str]:
    """국회의원 지역구를 시군구로 쪼갠다.
    '춘천시철원군화천군양구군갑' → ['춘천시','철원군','화천군','양구군']

    **긴 이름부터** 먹는다. '강남구갑' 에서 '남구' 를 먼저 집으면 '강' 이 남아 깨진다.
    맞는 게 없는 글자(갑·을·병)는 한 자씩 버린다.
    """
    out: list[str] = []
    s = district
    while s:
        for v in vocab:                      # 긴 것 우선으로 정렬돼 들어온다
            if s.startswith(v):
                out.append(v)
                s = s[len(v):]
                break
        else:
            s = s[1:]
    return out


def run_link(conn) -> int:
    """지역구 → 공사현장 지역(bid_notice.region) 대응표를 만든다.

    국회의원 지역구는 시군구보다 작거나(강남구갑/을/병) 여러 시군구를 묶는다
    (춘천시철원군화천군양구군). 공사현장은 시군구까지만 나오므로 시군구 단위로
    잇는다. 한 시군구를 여럿이 나눠 갖는 의원이 253명 중 168명이라, 이 표는
    '누가 해냈나' 가 아니라 '그 지역에서 무엇이 발주됐나' 에만 쓸 수 있다.
    """
    with conn.cursor() as cur:
        # 어휘는 두 곳에서 모은다. 구시군의장 선거구만 쓰면 제주(행정시)·세종처럼
        # 기초단체장 선거가 없는 곳이 빈다. 실제로 맞출 대상인 region 에서도 받는다.
        vocab: dict[str, set[str]] = {}
        cur.execute("select sd_name, district from candidacy"
                    " where office = '구시군의장' and district is not null group by 1,2")
        for sd, dist in cur.fetchall():
            vocab.setdefault(sd, set()).add(dist)
        cur.execute("select split_part(region,' ',1), substr(region, strpos(region,' ')+1)"
                    " from bid_notice where region like '%% %%' group by 1,2")
        for sd, dist in cur.fetchall():
            if sd and dist:
                vocab.setdefault(sd, set()).add(dist)
        by_sd = {k: sorted(v, key=len, reverse=True) for k, v in vocab.items()}

        # 사람마다 '자기의' 최근 당선을 본다. 전체 max(election_id) 를 쓰면 2026
        # 재보궐(당선자 14명)만 걸려 20줄로 끝난다(실측).
        cur.execute(
            "select distinct on (m.code) m.code, c.sd_name, c.district"
            " from member m join candidacy c"
            "   on c.member_code = m.code and c.elected and c.office = '국회의원'"
            " where m.is_incumbent and m.office = '국회의원'"
            "   and c.district <> '비례대표'"
            " order by m.code, c.election_id desc")
        rows, miss = [], 0
        for mcode, sd, dist in cur.fetchall():
            # 선관위 기록은 선거 당시 시도명이라 통합·개칭이 안 반영돼 있다.
            # '광주광역시 광산구' 로 두면 '전남광주통합특별시 광산구' 인 공사와 안 맞는다.
            sd = SIDO_ALIAS.get(sd, sd)
            parts = split_district(dist or "", by_sd.get(sd, []))
            if not parts:
                # 세종은 기초단체가 없다. 시도 자체가 공사현장 지역으로 찍힌다.
                rows.append((mcode, sd))
                miss += 1
                continue
            rows.extend((mcode, f"{sd} {q}") for q in parts)
        cur.execute("delete from member_sigungu")
        upsert(cur, "member_sigungu", ["member_code", "region"], rows,
               "member_code,region")
    conn.commit()
    print(f"[bid] 지역구-공사현장 대응 {len(rows)}줄"
          f"{f' (시군구가 없어 시도로 잡은 곳 {miss})' if miss else ''}", file=sys.stderr)
    return len(rows)


def months(since: str, until: str):
    """한 달씩 끊는다. 한 달이 전국 8,800건이라 999행씩 9쪽이면 받아진다."""
    cur = dt.date(int(since[:4]), int(since[4:6]), 1)
    end = dt.date(int(until[:4]), int(until[4:6]), 1)
    while cur <= end:
        nxt = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        last = nxt - dt.timedelta(days=1)
        yield (max(since, cur.strftime("%Y%m%d")) + "0000",
               min(until, last.strftime("%Y%m%d")) + "2359")
        cur = nxt


def fetch_page(client: httpx.Client, bgn: str, end: str, page: int):
    q = {"serviceKey": KEY, "type": "json", "inqryDiv": 1,
         "pageNo": page, "numOfRows": PAGE, "inqryBgnDt": bgn, "inqryEndDt": end}
    for attempt in range(4):
        try:
            data = client.get(URL, params=q).json()
            break
        except Exception as e:
            if attempt == 3:
                raise RuntimeError(f"{bgn}~{end} p{page}: {e}") from e
            time.sleep(5 * 2**attempt)

    body = data.get("response", {}).get("body")
    if body is None:
        # 활용신청 전이면 여기로 온다. 본문을 그대로 보여줘야 원인을 안다.
        raise RuntimeError(f"응답 형식이 다릅니다: {str(data)[:250]}")
    rows = body.get("items") or []
    if isinstance(rows, dict):
        rows = [rows]
    return rows, int(body.get("totalCount") or 0)


def run_fetch(conn, since: str, until: str, floor: int) -> int:
    with conn.cursor() as cur:
        orgs = tracked_orgs(cur)
    print(f"  추적 지자체 {len(orgs)}곳, 예산 {floor/1e8:.1f}억 이상", file=sys.stderr)

    kept = seen = 0
    with httpx.Client(timeout=90, headers={"User-Agent": "nureongso/0.1"}) as client, \
            conn.cursor() as cur:
        for bgn, end in months(since, until):
            page = 1
            while True:
                rows, total = fetch_page(client, bgn, end, page)
                if not rows:
                    break
                batch = []
                for r in rows:
                    # 예산금액이 깨졌으면 추정가격으로 대신한다. 부가세가 빠져 조금
                    # 작지만 없는 것보다 낫고, 1억 하한을 가르는 데는 충분하다.
                    amt = num(r.get("bdgtAmt")) or num(r.get("presmptPrce")) or 0
                    if amt < floor:
                        continue
                    # 공고기관과 수요기관이 다를 수 있다(도가 공고하고 시가 쓴다).
                    # 둘 중 우리가 아는 쪽을 그 사업의 주인으로 본다.
                    dem, ntc = d(r.get("dminsttNm")), d(r.get("ntceInsttNm"))
                    # 수요기관이 먼저다. 조달청이 대신 공고하는 일이 흔한데
                    # ('조달청 인천지방조달청'), 그 사업의 주인은 수요기관이다.
                    org = owner_of(dem, orgs) or owner_of(ntc, orgs)
                    if not org:
                        continue
                    no, ordn = d(r.get("bidNtceNo")), d(r.get("bidNtceOrd")) or "000"
                    if not no:
                        continue
                    batch.append((
                        f"{no}-{ordn}", d(r.get("bidNtceNm")), org, dem, ntc,
                        (d(r.get("bidNtceDt")) or "")[:10] or None,
                        amt, d(r.get("cnstrtsiteRgnNm")), d(r.get("bidNtceDtlUrl")),
                    ))
                upsert(cur, "bid_notice",
                       ["id", "name", "org", "demand_org", "notice_org",
                        "notice_at", "budget", "region", "url"],
                       batch, "id")
                conn.commit()
                seen += len(rows)
                kept += len(batch)
                if seen >= total or len(rows) < PAGE:
                    print(f"  {bgn[:6]} 전국 {total:,}건 → 보관 {kept:,}", file=sys.stderr)
                    break
                page += 1

        cur.execute("insert into ingest_run (source, finished_at, rows)"
                    " values ('bid', now(), %s)", (kept,))
        conn.commit()
    print(f"[bid] 전국 {seen:,}건 훑어 {kept:,}건 보관", file=sys.stderr)
    return kept


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch", "link", "all"])
    p.add_argument("--since", default=TERM_START)
    p.add_argument("--until", default=dt.date.today().strftime("%Y%m%d"))
    p.add_argument("--min", type=int, default=MIN_BUDGET)
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    if not KEY:
        sys.exit("DATA_GO_KR_KEY 가 없습니다.")
    with psycopg.connect(dsn) as conn:
        if a.step in ("fetch", "all"):
            run_fetch(conn, a.since, a.until, a.min)
        if a.step in ("link", "all"):
            run_link(conn)


if __name__ == "__main__":
    main()

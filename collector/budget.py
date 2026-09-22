#!/usr/bin/env python3
"""지방재정365 세부사업별 세출현황 수집기 — 예산사업형 공약에 붙일 돈.

사용:
    python budget.py fetch                # 최신 회계연도
    python budget.py fetch --year 2025
    python budget.py fetch --year 2025 --min 100000000   # 1억 이상만

환경변수: DATABASE_URL, LOFIN_KEY
    LOFIN_KEY 발급: https://www.lofin365.go.kr 회원가입 > 재정데이터개방 >
    세부사업별 세출현황 > 인증키 신청 (자동승인, 요청 횟수 제한 없음)
    DATA_GO_KR_KEY 로는 안 된다 — 포털에 등록돼 있지만 유형이 LINK 라 포털이
    중계하지 않고 lofin365 가 키를 따로 발급한다 (실측: ERROR-290).

왜 이 API 인가: 열린재정(중앙정부)이 아니다. 예산사업형 공약의 주인이 단체장이고,
국회의원 공약도 '○○동 하수관거 정비' 처럼 대부분 지자체 사업이다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys
import time

import httpx
import psycopg

from ingest import d, upsert

URL = "https://www.lofin365.go.kr/lf/hub/QWGJK"
KEY = os.getenv("LOFIN_KEY") or None
PAGE = 1000  # 인증키가 있을 때의 상한. 키가 없으면 뭘 줘도 5행만 온다.


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def fetch(client: httpx.Client, page: int, fyr: int, as_of: str) -> tuple[list[dict], int]:
    """한 페이지. (rows, 총건수). 데이터 없음이면 ([], 0)."""
    q = {"Key": KEY, "Type": "json", "pIndex": page, "pSize": PAGE,
         "fyr": fyr, "exe_ymd": as_of}
    for attempt in range(4):
        try:
            data = client.get(URL, params=q).json()
            break
        except Exception as e:
            if attempt == 3:
                raise RuntimeError(f"{fyr}/{as_of} p{page}: {e}") from e
            time.sleep(5 * 2**attempt)   # 5, 10, 20초

    body = data.get("QWGJK")
    if not body:                          # INFO-200(데이터 없음) / ERROR-290(키) 등
        msg = str(data)[:200]
        if "ERROR" in msg:
            raise RuntimeError(f"{fyr}/{as_of}: {msg}")
        return [], 0
    head = body[0]["head"]
    rows = body[1]["row"] if len(body) > 1 else []
    return rows, int(head[0]["list_total_count"])


def latest_as_of(client: httpx.Client, fyr: int) -> str:
    """그 회계연도에 실제로 데이터가 있는 가장 최근 집행일자.

    지난 연도는 12월 31일이 확정치다. 진행 중인 연도는 당일 스냅샷이 다음 날
    오전에야 채워지므로, 오늘부터 거꾸로 짚어 데이터가 있는 날을 찾는다.
    """
    if fyr < dt.date.today().year:
        return f"{fyr}1231"
    day = dt.date.today()
    for _ in range(10):
        ymd = day.strftime("%Y%m%d")
        if fetch(client, 1, fyr, ymd)[1]:
            return ymd
        day -= dt.timedelta(days=1)
    sys.exit(f"{fyr} 회계연도 데이터를 찾지 못했습니다 (최근 10일 확인).")


COLS = ["fyr", "laf_cd", "dept_cd", "dbiz_cd", "acnt_cd", "laf_name", "dbiz_nm",
        "fld_nm", "planned", "budget", "spent", "natl", "prov", "local", "as_of"]


def ingest(cur, client: httpx.Client, fyr: int, as_of: str, floor: int) -> int:
    seen: dict[tuple, tuple] = {}
    total = None
    page = 1
    while True:
        rows, total = fetch(client, page, fyr, as_of)
        if not rows:
            break
        for r in rows:
            budget = num(r.get("bdg_cash_amt")) or 0
            if budget < floor:
                continue
            key = (fyr, d(r.get("laf_cd")), d(r.get("dept_cd")),
                   d(r.get("dbiz_cd")), d(r.get("acnt_dv_cd")))
            # 같은 키가 두 페이지에 걸쳐 오는 일이 있다. 정부가 스냅샷을 채우는
            # 중에 받으면 페이지 사이로 행이 밀린다. 그대로 합산하면 금액이
            # 부풀어 오르므로 마지막에 본 값만 남긴다.
            seen[key] = key + (
                d(r.get("laf_hg_nm")), d(r.get("dbiz_nm")), d(r.get("fld_nm")),
                num(r.get("cpl_amt")), budget, num(r.get("ep_amt")),
                num(r.get("bdg_ntep")), num(r.get("capep")), num(r.get("sggep")),
                dt.datetime.strptime(as_of, "%Y%m%d").date(),
            )
        got = page * PAGE
        if page % 50 == 0:
            print(f"  {fyr} {got}/{total}", file=sys.stderr)
        if got >= total:
            break
        page += 1

    # 정부가 스냅샷을 채우는 중이면 응답이 중간에 마르면서 조용히 일부만 들어온다.
    # 덮어쓰면 그 상태가 박제되므로, 받은 양이 API 가 말한 총건수에 못 미치면 멈춘다.
    if total and got < total * 0.99 and floor == 0:
        sys.exit(f"{fyr}: {total}건 중 {got}건만 받았습니다. 적재 중일 수 있으니 다시 시도하세요.")

    vals = list(seen.values())
    for i in range(0, len(vals), 5000):
        upsert(cur, "budget_biz", COLS, vals[i:i + 5000],
               "fyr,laf_cd,dept_cd,dbiz_cd,acnt_cd")
    return len(vals)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch"])
    p.add_argument("--year", type=int, default=dt.date.today().year)
    p.add_argument("--min", type=int, default=0,
                   help="예산현액 하한(원). 용량이 모자랄 때만 쓴다 — 1억 컷은 사업 수를 "
                        "43%%로 줄이지만 '치과진료 지원' 같은 소규모 공약을 놓친다.")
    args = p.parse_args()

    if not KEY:
        sys.exit("LOFIN_KEY 가 없습니다. https://www.lofin365.go.kr 에서 발급하세요.")
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")

    with httpx.Client(timeout=60, headers={"User-Agent": "nureongso/0.1"}) as client:
        as_of = latest_as_of(client, args.year)
        print(f"[budget] {args.year} 회계연도, 집행일자 {as_of}", file=sys.stderr)
        with psycopg.connect(dsn) as conn:
            with conn.cursor() as cur:
                n = ingest(cur, client, args.year, as_of, args.min)
            conn.commit()
    print(f"[budget] {args.year}: 세부사업 {n:,}건", file=sys.stderr)


if __name__ == "__main__":
    main()

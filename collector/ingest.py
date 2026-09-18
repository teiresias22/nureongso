#!/usr/bin/env python3
"""누렁소검은소 수집기.

사용:
    python ingest.py members            # 역대+현역 의원
    python ingest.py bills --age 22     # 발의법률안 + 발의/공동발의
    python ingest.py plenary --age 22   # 본회의 처리 의안
    python ingest.py votes --age 22     # 본회의 표결 (plenary 먼저 실행)
    python ingest.py refresh            # member_stats 갱신
    python ingest.py all --age 22

환경변수: DATABASE_URL (Supabase > Settings > Database > Connection string),
          ASSEMBLY_API_KEY (필수. https://open.assembly.go.kr 무료 발급)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import httpx
import psycopg

BASE = "https://open.assembly.go.kr/portal/openapi"
KEY = os.getenv("ASSEMBLY_API_KEY") or None
PAGE = 1000  # API 최대

SERVICES = {
    "incumbent": "nwvrqwxyaytdsfvhu",  # 현역 국회의원 인적사항
    "allmember": "ALLNAMEMBER",  # 역대 국회의원 인적사항
    "bills": "nzmimeepazxkubdpn",  # 국회의원 발의법률안
    "plenary": "ncocpgfiaoituanbr",  # 본회의 처리 의안 (표결 집계)
    "votes": "nojepdqqaweusdfbi",  # 국회의원 본회의 표결
}


def fetch(service: str, max_rows: int | None = None, **params) -> list[dict]:
    """서비스 전체 row 를 페이지 순회로 가져온다. max_rows 로 조기 종료(테스트용).

    인증키 없이 호출하면 서버가 pIndex/pSize 를 무시하고 매번 첫 5행만 돌려준다.
    (총건수 head 는 정상값을 주므로 조용히 같은 행을 반복 수집하게 된다.)
    그래서 KEY 는 필수이고, 그래도 페이지가 안 넘어가면 아래에서 중단한다.
    """
    if not KEY:
        raise RuntimeError(
            "ASSEMBLY_API_KEY 가 필요합니다. 키 없이 호출하면 서버가 페이지네이션을 무시하고"
            " 첫 5행만 반복해서 돌려줍니다. https://open.assembly.go.kr 에서 무료 발급하세요."
        )
    name = SERVICES[service]
    out: list[dict] = []
    seen: set[str] = set()
    page = 1
    with httpx.Client(timeout=60, headers={"User-Agent": "nureongso/0.1"}) as c:
        while True:
            q = {"Type": "json", "pIndex": page, "pSize": PAGE, "KEY": KEY, **params}
            for attempt in range(3):
                try:
                    data = c.get(f"{BASE}/{name}", params=q).json()
                    break
                except Exception as e:  # 네트워크/JSON 오류만 재시도
                    if attempt == 2:
                        raise
                    print(f"  retry {attempt + 1}: {e}", file=sys.stderr)
                    time.sleep(2 * (attempt + 1))

            if "RESULT" in data:  # 에러 또는 데이터 없음
                code = data["RESULT"]["CODE"]
                if code.startswith("INFO-200"):  # 해당 데이터 없음
                    break
                raise RuntimeError(f"{name}: {data['RESULT']}")

            body = data[name]
            rows = next((b["row"] for b in body if "row" in b), [])
            total = body[0]["head"][0]["list_total_count"]

            # 페이지가 실제로 넘어갔는지 확인. 서버가 pIndex 를 무시하면 같은 행이 다시 온다.
            fresh = [r for r in rows if (k := json.dumps(r, sort_keys=True)) not in seen and not seen.add(k)]
            if rows and not fresh:
                raise RuntimeError(
                    f"{name}: pIndex={page} 가 이전 페이지와 같은 행을 반환했습니다."
                    " 인증키가 유효한지 확인하세요."
                )
            out.extend(fresh)
            print(f"  {name} {len(out)}/{total}", file=sys.stderr)
            if len(out) >= total or not rows or (max_rows and len(out) >= max_rows):
                break
            page += 1
    return out


def upsert(cur, table: str, cols: list[str], rows: list[tuple], conflict: str, update: bool = True):
    if not rows:
        return
    ph = ",".join(["%s"] * len(cols))
    collist = ",".join(cols)
    if update:
        sets = ",".join(f"{c}=excluded.{c}" for c in cols if c not in conflict.split(","))
        action = f"do update set {sets}" if sets else "do nothing"
    else:
        action = "do nothing"
    sql = f"insert into {table} ({collist}) values ({ph}) on conflict ({conflict}) {action}"
    cur.executemany(sql, rows)


def d(v):
    """빈 문자열 -> None, 날짜 문자열 정리."""
    if v is None:
        return None
    v = str(v).strip()
    return v or None


# --------------------------------------------------------------------------- 의원


def ingest_members(cur) -> int:
    hist = fetch("allmember")
    inc = fetch("incumbent")
    incumbent_codes = {r["MONA_CD"] for r in inc if r.get("MONA_CD")}

    rows = []
    for r in hist:
        code = d(r.get("NAAS_CD"))
        if not code:
            continue
        rows.append(
            (
                code,
                d(r.get("NAAS_NM")),
                d(r.get("NAAS_CH_NM")),
                d(r.get("BIRDY_DT")),
                d(r.get("NTR_DIV")),
                d(r.get("PLPT_NM")),
                d(r.get("ELECD_NM")),
                d(r.get("ELECD_DIV_NM")),
                d(r.get("GTELT_ERACO")),
                d(r.get("RLCT_DIV_NM")),
                d(r.get("BLNG_CMIT_NM")),
                d(r.get("NAAS_PIC")),
                d(r.get("NAAS_TEL_NO")),
                d(r.get("NAAS_EMAIL_ADDR")),
                d(r.get("NAAS_HP_URL")),
                code in incumbent_codes,
            )
        )
    cols = [
        "code", "name", "name_hanja", "birth", "sex", "party", "district",
        "elect_type", "terms", "term_count", "committees", "photo_url",
        "tel", "email", "homepage", "is_incumbent",
    ]
    upsert(cur, "member", cols, rows, "code")

    # 현역은 최신값(정당/지역구/위원회)이 현역 API 쪽이 정확하므로 덮어쓴다.
    inc_rows = [
        (
            d(r.get("POLY_NM")), d(r.get("ORIG_NM")), d(r.get("ELECT_GBN_NM")),
            d(r.get("CMIT_NM")), d(r.get("REELE_GBN_NM")), d(r.get("UNITS")),
            d(r.get("TEL_NO")), d(r.get("E_MAIL")), d(r.get("HOMEPAGE")),
            d(r.get("MONA_CD")),
        )
        for r in inc if r.get("MONA_CD")
    ]
    cur.executemany(
        "update member set party=%s, district=%s, elect_type=%s, committees=%s,"
        " term_count=%s, terms=%s, tel=%s, email=%s, homepage=%s, is_incumbent=true"
        " where code=%s",
        inc_rows,
    )
    return len(rows)


# --------------------------------------------------------------------------- 법안


def ingest_bills(cur, age: int) -> int:
    rows = fetch("bills", AGE=age)
    bills, sponsors = [], []
    for r in rows:
        bid = d(r.get("BILL_ID"))
        if not bid:
            continue
        bills.append(
            (
                bid, age, d(r.get("BILL_NO")), d(r.get("BILL_NAME")),
                d(r.get("COMMITTEE")), d(r.get("PROPOSE_DT")),
                d(r.get("PROC_RESULT")), d(r.get("PROC_DT")),
                d(r.get("PROPOSER")), d(r.get("DETAIL_LINK")),
            )
        )
        if rst := d(r.get("RST_MONA_CD")):
            for code in rst.split(","):
                if code.strip():
                    sponsors.append((bid, code.strip(), "rep"))
        if publ := d(r.get("PUBL_MONA_CD")):
            for code in publ.split(","):
                if code.strip():
                    sponsors.append((bid, code.strip(), "co"))

    upsert(
        cur, "bill",
        ["bill_id", "age", "bill_no", "name", "committee", "proposed_at",
         "proc_result", "proc_dt", "proposer", "detail_link"],
        bills, "bill_id",
    )
    # 대표발의자가 공동발의 명단에도 들어간 경우 중복 제거
    sponsors = list(dict.fromkeys(sponsors))
    upsert(cur, "bill_sponsor", ["bill_id", "member_code", "role"],
           sponsors, "bill_id,member_code,role", update=False)
    print(f"  bills={len(bills)} sponsors={len(sponsors)}", file=sys.stderr)
    return len(bills)


def ingest_plenary(cur, age: int) -> int:
    rows = fetch("plenary", AGE=age)
    out = [
        (
            d(r.get("BILL_ID")), age, d(r.get("BILL_NO")), d(r.get("BILL_NAME")),
            d(r.get("CURR_COMMITTEE")), d(r.get("PROC_DT")), d(r.get("PROC_RESULT_CD")),
            r.get("YES_TCNT"), r.get("NO_TCNT"), r.get("BLANK_TCNT"),
            r.get("VOTE_TCNT"), r.get("MEMBER_TCNT"),
        )
        for r in rows if r.get("BILL_ID")
    ]
    upsert(
        cur, "plenary_bill",
        ["bill_id", "age", "bill_no", "name", "committee", "proc_dt", "proc_result",
         "yes_cnt", "no_cnt", "blank_cnt", "vote_cnt", "member_cnt"],
        out, "bill_id",
    )
    return len(out)


def ingest_votes(cur, age: int, only_new: bool = True) -> int:
    """표결은 의안 단위 호출이라 건수가 많다. 이미 받은 의안은 건너뛴다."""
    cur.execute("select bill_id from plenary_bill where age = %s", (age,))
    todo = [r[0] for r in cur.fetchall()]
    if only_new:
        cur.execute("select distinct bill_id from vote")
        done = {r[0] for r in cur.fetchall()}
        todo = [b for b in todo if b not in done]

    total = 0
    for i, bid in enumerate(todo, 1):
        rows = fetch("votes", AGE=age, BILL_ID=bid)
        out = [
            (bid, d(r.get("MONA_CD")), d(r.get("RESULT_VOTE_MOD")), parse_dt(r.get("VOTE_DATE")))
            for r in rows if r.get("MONA_CD")
        ]
        upsert(cur, "vote", ["bill_id", "member_code", "result", "voted_at"],
               out, "bill_id,member_code")
        total += len(out)
        if i % 20 == 0:
            print(f"  votes {i}/{len(todo)} bills, {total} rows", file=sys.stderr)
    return total


def parse_dt(v):
    """'20260917 161700' -> ISO."""
    v = d(v)
    if not v or len(v) < 8:
        return None
    date, _, t = v.partition(" ")
    t = (t + "000000")[:6]
    return f"{date[:4]}-{date[4:6]}-{date[6:8]} {t[:2]}:{t[2:4]}:{t[4:6]}"


# --------------------------------------------------------------------------- run


STEPS = {
    "members": lambda cur, age: ingest_members(cur),
    "bills": lambda cur, age: ingest_bills(cur, age),
    "plenary": lambda cur, age: ingest_plenary(cur, age),
    "votes": lambda cur, age: ingest_votes(cur, age),
}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=[*STEPS, "refresh", "all"])
    p.add_argument("--age", type=int, default=22)
    args = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다. .env 를 확인하세요.")

    steps = list(STEPS) if args.step == "all" else ([] if args.step == "refresh" else [args.step])

    with psycopg.connect(dsn, autocommit=False) as conn:
        for name in steps:
            with conn.cursor() as cur:
                cur.execute("insert into ingest_run (source) values (%s) returning id",
                            (f"{name}:{args.age}",))
                run_id = cur.fetchone()[0]
            conn.commit()
            print(f"[{name}] 시작", file=sys.stderr)
            try:
                with conn.cursor() as cur:
                    n = STEPS[name](cur, args.age)
                conn.commit()
                with conn.cursor() as cur:
                    cur.execute("update ingest_run set finished_at=now(), rows=%s where id=%s",
                                (n, run_id))
                conn.commit()
                print(f"[{name}] 완료 {n} rows", file=sys.stderr)
            except Exception as e:
                conn.rollback()
                with conn.cursor() as cur:
                    cur.execute("update ingest_run set finished_at=now(), error=%s where id=%s",
                                (str(e)[:2000], run_id))
                conn.commit()
                raise

        if args.step in ("refresh", "all"):
            with conn.cursor() as cur:
                cur.execute("refresh materialized view concurrently member_stats")
            conn.commit()
            print("[refresh] member_stats 갱신", file=sys.stderr)


if __name__ == "__main__":
    main()

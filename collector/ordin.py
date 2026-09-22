#!/usr/bin/env python3
"""자치법규(조례·규칙) 수집기 — 조례제도형 공약에 붙일 근거.

단체장·교육감 공약의 1,438건이 '조례제도' 로 분류돼 있는데 지금은 전부 판단불가다.
조례는 제정일이 공식 기록으로 남으므로, 법안과 똑같이 객관적인 근거가 된다.

사용:
    python ordin.py fetch                 # 취임일(2026-07-01) 이후 전국 제·개정
    python ordin.py fetch --since 20260701 --until 20261231
    python ordin.py fetch --kind 제정     # 제정만 (기본은 제·개정 모두)

환경변수: DATABASE_URL, LAW_OC
    LAW_OC 발급: https://open.law.go.kr 회원가입 후 이메일 ID 앞부분.
    (예: hong@gmail.com 이면 LAW_OC=hong) 무료, 신청·승인 절차 없음.
    없으면 공용 시험 계정 'test' 로 도는데, 남이 같이 쓰므로 막힐 수 있다.

왜 전량 수집인가: 공약마다 API 를 두드리면 1,438회가 되지만, 취임 이후 전국
제·개정을 통째로 받으면 13,000행 · 130회다. 조례명은 짧아 용량도 몇 MB다.
예산사업(163MB)처럼 DB 를 잡아먹지 않는다.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import httpx
import psycopg

from ingest import d, upsert

URL = "https://www.law.go.kr/DRF/lawSearch.do"
# 공용 시험 계정. 남과 같이 쓰는 것이라 언제든 막힐 수 있다 — 자기 OC 를 쓰는 게 맞다.
OC = os.getenv("LAW_OC") or "test"
PAGE = 100          # display 상한
# 제·개정 구분 코드. 목록 API 의 rrClsCd 값이다.
RR_CLS = {"제정": "300201", "일부개정": "300202", "전부개정": "300203", "폐지": "300204"}

# 제9회 지방선거 당선자 취임일. 이 날 이후의 조례만 그 사람 임기의 것이다.
TERM_START = "20260701"


def fetch_page(client: httpx.Client, page: int, since: str, until: str,
               rr: str | None) -> tuple[list[dict], int]:
    """한 페이지. (rows, 총건수)."""
    q = {"OC": OC, "target": "ordin", "type": "JSON", "display": PAGE,
         "page": page, "sort": "ddes", "efYd": f"{since}~{until}"}
    if rr:
        q["rrClsCd"] = rr
    for attempt in range(4):
        try:
            data = client.get(URL, params=q).json()
            break
        except Exception as e:
            if attempt == 3:
                raise RuntimeError(f"p{page}: {e}") from e
            time.sleep(5 * 2**attempt)

    body = data.get("OrdinSearch")
    if not body:
        # OC 가 틀리면 여기로 온다. 본문을 그대로 보여줘야 원인을 안다.
        raise RuntimeError(f"응답 형식이 다릅니다 (LAW_OC 확인): {str(data)[:200]}")
    rows = body.get("law") or []
    if isinstance(rows, dict):      # 1건이면 배열이 아니라 객체로 온다
        rows = [rows]
    return rows, int(body.get("totalCnt") or 0)


def run_fetch(conn, since: str, until: str, kind: str | None) -> int:
    rr = RR_CLS.get(kind) if kind else None
    if kind and not rr:
        sys.exit(f"모르는 제개정 구분: {kind} (가능: {', '.join(RR_CLS)})")

    total = seen = 0
    with httpx.Client(timeout=60) as client, conn.cursor() as cur:
        page = 1
        while True:
            rows, total = fetch_page(client, page, since, until, rr)
            if not rows:
                break
            batch = []
            for r in rows:
                oid = d(r.get("자치법규일련번호"))
                if not oid:
                    continue
                batch.append((
                    oid,
                    d(r.get("자치법규ID")),
                    d(r.get("자치법규명")),
                    d(r.get("지자체기관명")),
                    d(r.get("자치법규종류")),
                    d(r.get("제개정구분명")),
                    d(r.get("시행일자")),
                    d(r.get("공포일자")),
                    # 상세링크는 OC 가 박혀서 온다. 남의 계정이 박힌 주소를 저장하면
                    # 그 계정이 막히는 날 화면의 링크가 전부 죽는다. 공개 주소로 바꾼다.
                    f"https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq={oid}",
                ))
            upsert(cur, "ordinance",
                   ["id", "ordin_id", "name", "org", "kind", "rr_kind",
                    "effective_at", "announced_at", "url"],
                   batch, "id")
            conn.commit()
            seen += len(batch)
            print(f"  [{seen}/{total}] p{page}", file=sys.stderr)
            if seen >= total or len(rows) < PAGE:
                break
            page += 1

        cur.execute("insert into ingest_run (source, finished_at, rows)"
                    " values ('ordin', now(), %s)", (seen,))
        conn.commit()
    print(f"[ordin] {seen:,}건 수집 (전체 {total:,})", file=sys.stderr)
    return seen


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch"])
    p.add_argument("--since", default=TERM_START)
    p.add_argument("--until", default="20991231")
    p.add_argument("--kind", default=None, help="제정 / 일부개정 / 전부개정 / 폐지")
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    if OC == "test":
        print("[ordin] LAW_OC 가 없어 공용 시험 계정으로 돕니다."
              " https://open.law.go.kr 가입 후 LAW_OC 를 넣으세요.", file=sys.stderr)
    with psycopg.connect(dsn) as conn:
        run_fetch(conn, a.since, a.until, a.kind)


if __name__ == "__main__":
    main()

"""열린재정 — 중앙정부 세출/지출 세부사업 예산편성현황.

**지금은 어디에도 연결돼 있지 않다.** 공약 이행 근거로 쓰려고 붙였다가, 재보니
쓸 수 없어서 떼어냈다. 되살릴 때 같은 길을 두 번 걷지 않도록 잰 값을 남긴다.

왜 뺐나 (2026-09-23 실측):

1. 세부사업은 대개 **전국 단위 덩어리**다. 2025·2026년 17,803건 중 지명이 든 것은
   13%(1,213건)뿐이고, 그중 상당수는 '경찰서 신축' 같은 관서 건물이다.
2. LLM 매칭 정밀도 **10건 중 5건**. 틀린 5건은 모두 '지역사랑상품권 발행지원',
   '건강생활지원센터 확충', '탄소중립도시숲조성' 같은 전국 보조사업을 특정 의원
   공약에 붙인 것이다. 프롬프트에 "지명 없는 덩어리 사업에 붙이지 마라" 고 적어도
   지켜지지 않았다.
3. 기계로 막아보려 했으나 안 된다. 시군구 어간이 두 글자라 '성동' 이
   '방사성동위원소', '달성' 이 '국가NDC달성기여' 에 걸린다.
4. 가장 좁힌 규칙(노선형 SOC 사업명이 공약 글에 글자 그대로 든 것)까지 조여도
   **5,006건 중 16건**이고 그중 4건이 틀렸다('김포-서울 출퇴근' 에
   '김포-파주고속도로' 를 붙이는 식).
5. 맞게 붙어도 귀속이 안 된다. 가덕도신공항에 예산이 잡힌 게 김해시을 의원이
   한 일은 아니다.

되살릴 값어치가 생기는 때: 열린재정이 **세세사업(내역사업)** 을 열어 줄 때다.
지역 사업은 그 단계에 있다. 지금 API 는 그 위 단계까지만 준다.

살려 쓰려면 아래 테이블이 필요하다. 판정 분기(judge.py)와 화면은 커밋하지 않았으니
match_bid 를 본떠 새로 쓰면 된다.

    create table fiscal_program (
      id           text primary key,   -- '2026|국토교통부|남양주-춘천1 국도건설'
      fiscal_year  int not null,
      ministry     text not null,      -- 소관
      name         text not null,      -- 세부사업명
      field        text,               -- 분야
      program      text,               -- 프로그램
      amount       bigint              -- 예산(원). API 는 천원으로 준다
    );
    create index fiscal_program_name_trgm
      on fiscal_program using gin (name gin_trgm_ops);
    alter table fiscal_program enable row level security;
    create policy public_read on fiscal_program for select using (true);

알아둘 것: **브라우저 User-Agent 가 없으면 307 로 error.html 에 떨궈진다.** 키
문제로 착각하기 쉽다. 그리고 이 엔드포인트는 키가 없어도 응답한다(엉터리 키는
거부한다). 한도를 알 수 없으니 키를 넣고 쓰는 게 낫다.

    python fiscal.py fetch                  # 편성연도 기본 2025,2026

환경변수: DATABASE_URL, OPENFISCAL_KEY
    OPENFISCAL_KEY 발급: https://www.openfiscaldata.go.kr > Open API > 인증키 발급
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

import psycopg

URL = "https://openapi.openfiscaldata.go.kr/ExpenditureBudgetInit5"
KEY = os.getenv("OPENFISCAL_KEY") or None
PAGE = 1000

# 제22대 국회 임기(2024-05-30~) 안에서 **편성된** 예산연도. 2024년 예산은 2023년
# 가을에 짜였으니 이 국회의 일이 아니다. 2025·2026 만 본다.
YEARS = (2025, 2026)

# 브라우저 UA 가 없으면 307 로 error.html 에 떨궈진다. 키 문제로 착각하기 쉽다.
UA = "Mozilla/5.0 (compatible; nureongso/1.0)"


def get(**params) -> list[dict]:
    p = {"Type": "json", "pSize": PAGE, **params}
    if KEY:
        p["Key"] = KEY
    req = urllib.request.Request(URL + "?" + urllib.parse.urlencode(p),
                                 headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            raw = urllib.request.urlopen(req, timeout=60).read()
            break
        except Exception as e:                       # 일시적 장애가 잦다
            if attempt == 3:
                raise
            print(f"    재시도 {attempt + 1}: {type(e).__name__}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    # 응답이 JSON 문자열을 담은 JSON 이다. 한 번 더 푼다.
    data = json.loads(raw)
    if isinstance(data, str):
        data = json.loads(data)
    if "RESULT" in data:                             # 인증 실패 등
        raise RuntimeError(str(data["RESULT"])[:200])
    body = data["ExpenditureBudgetInit5"]
    return body[1]["row"] if len(body) > 1 else []


def run_fetch(conn, years: list[int]) -> None:
    # 같은 세부사업이 회계별로 나뉘어 오고(일반회계/특별회계/기금), 드물게 같은
    # 회계 안에서도 두 줄로 온다. 이름이 같으면 한 사업이라 금액을 더한다.
    total: defaultdict[tuple[int, str, str], int] = defaultdict(int)
    extra: dict[tuple[int, str, str], tuple[str, str]] = {}

    for yy in years:
        got = 0
        for page in range(1, 30):
            rows = get(FSCL_YY=yy, pIndex=page)
            if not rows:
                break
            for r in rows:
                name = (r.get("SACTV_NM") or "").strip()
                offc = (r.get("OFFC_NM") or "").strip()
                if not name or not offc:
                    continue
                k = (yy, offc, name)
                # 천원 단위로 온다. bid_notice.budget 과 맞추려고 원으로 바꾼다.
                total[k] += (r.get("Y_YY_MEDI_KCUR_AMT") or 0) * 1000
                extra.setdefault(k, ((r.get("FLD_NM") or "").strip(),
                                     (r.get("PGM_NM") or "").strip()))
            got += len(rows)
            if len(rows) < PAGE:
                break
            time.sleep(0.5)
        print(f"  {yy}년 {got:,}건", file=sys.stderr)

    rows_ = [(f"{yy}|{offc}|{name}", yy, offc, name,
              extra[(yy, offc, name)][0], extra[(yy, offc, name)][1], amt)
             for (yy, offc, name), amt in total.items()]

    with conn.cursor() as cur:
        cur.executemany(
            "insert into fiscal_program"
            " (id, fiscal_year, ministry, name, field, program, amount)"
            " values (%s,%s,%s,%s,%s,%s,%s)"
            " on conflict (id) do update set amount = excluded.amount,"
            "   field = excluded.field, program = excluded.program", rows_)
        cur.execute("insert into ingest_run (source, finished_at, rows)"
                    " values ('fiscal', now(), %s)", (len(rows_),))
    conn.commit()
    print(f"[fiscal] 세부사업 {len(rows_):,}건 보관", file=sys.stderr)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch"])
    p.add_argument("--years", default=",".join(str(y) for y in YEARS))
    a = p.parse_args()

    if not KEY:
        print("[fiscal] OPENFISCAL_KEY 가 없습니다. 키 없이도 응답은 오지만"
              " 한도가 어떻게 걸리는지 알 수 없습니다.", file=sys.stderr)

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        run_fetch(conn, [int(y) for y in a.years.split(",")])


if __name__ == "__main__":
    main()

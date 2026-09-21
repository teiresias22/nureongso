#!/usr/bin/env python3
"""분류·매칭 품질 검수용 표본 추출.

자동 분류를 믿기 전에 사람이 직접 보고 맞는지 확인한다. 유형별로 고르게 뽑아
한쪽 유형만 잘 맞는 상황을 놓치지 않는다.

    python sample_review.py kind   [--n 30]   # 공약 유형 분류 표본
    python sample_review.py match  [--n 30]   # 공약-법안 연결 표본
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg

# 유형별로 고르게 뽑는다. 한 유형만 잘 맞는 상황을 놓치지 않기 위해서다.
# kinds 가 배열이라 unnest 로 펼친 뒤 유형마다 같은 수를 뽑는다.
KIND_SQL = """
with flat as (
  select p.id, p.title, coalesce(p.body,'') as body, p.category, p.kinds,
         unnest(p.kinds) as one, p.member_code
  from pledge p where p.kinds is not null
),
picked as (
  select *, row_number() over (partition by one order by md5(id::text || one)) as rn
  from flat
)
select distinct on (id) m.name, m.office, picked.kinds, picked.category,
       picked.title, picked.body
from picked join member m on m.code = picked.member_code
where picked.rn <= %(per)s
order by id
"""

MATCH_SQL = """
select m.name, p.title, e.score, e.summary,
       b.name as bill_name, coalesce(b.proc_result, '계류') as result
from pledge_evidence e
join pledge p on p.id = e.pledge_id
join member m on m.code = p.member_code
join bill b on b.bill_id = e.ref_id
where e.kind = 'bill'
order by md5(e.pledge_id::text || e.ref_id)
limit %(n)s
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["kind", "match"])
    ap.add_argument("--n", type=int, default=30)
    a = ap.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")

    with psycopg.connect(dsn) as c, c.cursor() as cur:
        if a.what == "kind":
            cur.execute("select count(distinct k) from pledge, unnest(kinds) k")
            kinds = cur.fetchone()[0] or 1
            cur.execute(KIND_SQL, {"per": max(1, a.n // kinds)})
            for name, office, ks, cat, title, body in cur.fetchall():
                print(f"[{'+'.join(ks)}] {name}({office}) · {cat}")
                print(f"    {title}")
                if body:
                    print(f"    └ {body[:150].replace(chr(10), ' ')}")
        else:
            cur.execute(MATCH_SQL, {"n": a.n})
            for name, title, score, why, bill, result in cur.fetchall():
                print(f"{name} | 신뢰도 {score}")
                print(f"  공약: {title}")
                print(f"  법안: {bill} [{result}]")
                print(f"  이유: {why}")


if __name__ == "__main__":
    main()

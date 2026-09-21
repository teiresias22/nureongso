#!/usr/bin/env python3
"""공약 이행 판정 — 사실 수집은 자동, 판정은 공개된 규칙으로.

이행 여부는 어느 기관도 공식 제공하지 않는다. 그래서 '사실' 과 '해석' 을 분리한다.

  classify  공약마다 무엇으로 이행을 확인할 수 있는지 유형을 붙인다 (LLM)
  match     입법형 공약을 본인 대표발의 법안과 대조해 근거를 붙인다 (LLM)
  decide    근거를 보고 규칙표대로 판정한다 (LLM 없음, 몇 번 돌려도 같은 결과)

실측: 국회의원 공약의 10%만 입법형이고 60%는 지역 사업이다. 사업형은 이번 단계에서
측정하지 않고 '측정 수단 없음' 으로 남긴다. 억지로 판정하는 쪽이 더 해롭다.

사용:
    python judge.py classify --limit 5    # 먼저 소량으로 품질 확인
    python judge.py all
    python judge.py decide                # 규칙만 다시 적용

환경변수: DATABASE_URL + llm.py 가 쓰는 것 (기본 GEMINI_API_KEY)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import psycopg

import llm

# 공약을 무엇으로 잴 수 있는가. 이 다섯 가지 외에는 받지 않는다.
KINDS = ["입법", "예산사업", "조례제도", "선언", "기타"]

# 22대 국회 임기 시작. '아직 안 했다' 와 '이제 시작했다' 를 가르는 기준일.
TERM_START = "2024-05-30"
GRACE_YEARS = 2

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"id": {"type": "integer"},
                               "kind": {"type": "string", "enum": KINDS}},
                "required": ["id", "kind"],
            },
        }
    },
    "required": ["items"],
}

CLASSIFY_PROMPT = """한국 선거 공약 목록이다. 각 공약을 **무엇으로 이행 여부를 확인할 수 있는가**
기준으로 분류하라. 공약의 주제(교통·복지 등)가 아니라 '확인 수단' 으로 나누는 것이다.

- 입법: 법률의 제정·개정이 있어야 이뤄진다. 국회 법안 발의·통과로 확인한다.
- 예산사업: 특정 시설·도로·기관을 짓거나 유치하거나 사업을 벌인다. 예산 편성과 착공으로 확인한다.
- 조례제도: 지방자치단체 조례나 행정 제도·지침 변경으로 이뤄진다.
- 선언: 구체적 대상이나 수단이 없는 방향 제시다. ("살기 좋은 도시", "소통하는 의정")
  무엇을 보면 이뤄졌는지 말할 수 없으면 선언이다.
- 기타: 위 어디에도 맞지 않는다.

판단이 애매하면 더 좁은 쪽(입법 < 예산사업 < 조례제도)이 아니라 **선언**으로 보내라.
잘못 입법으로 분류하면 없는 법안을 찾게 되어 판정이 틀어진다.

모든 공약에 대해 {"items":[{"id":<id>,"kind":"<유형>"}]} 형식으로 답하라. 빠뜨리지 마라.

공약 목록:
{items}"""

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pledge_id": {"type": "integer"},
                    "bill_id": {"type": "string"},
                    "confidence": {"type": "number"},
                    "why": {"type": "string"},
                },
                "required": ["pledge_id", "bill_id", "confidence"],
            },
        }
    },
    "required": ["matches"],
}

MATCH_PROMPT = """어떤 국회의원의 '입법형 공약' 목록과, 그 의원이 **직접 대표발의한 법안** 목록이다.
각 공약을 이행하기 위해 발의한 것으로 보이는 법안을 찾아 연결하라.

규칙:
- 반드시 아래 법안 목록에 있는 bill_id 만 쓴다. 없는 id 를 지어내지 마라.
- 공약과 법안이 같은 문제를 다룰 때만 연결한다. 분야가 같다는 이유로 연결하지 마라.
  (예: 공약 '노인 간병비 지원' ↔ 법안 '노인복지법 개정' 은 내용이 맞아야만 연결)
- 한 공약에 법안이 여럿이면 여럿 다 쓴다. 맞는 법안이 없으면 그 공약은 빼라.
  **없는 것을 억지로 붙이는 쪽이 빠뜨리는 쪽보다 훨씬 해롭다.**
- confidence 는 0~1. 법안 이름만으로 판단하므로 확신이 없으면 낮게 준다.
- why 는 왜 연결했는지 한 줄 (40자 이내).

공약:
{pledges}

대표발의 법안:
{bills}"""


# --------------------------------------------------------------------------- classify


def run_classify(conn, limit: int | None, redo: bool) -> None:
    """의원 1명당 1회 호출. 그 사람 공약 전부를 한 번에 분류한다."""
    with conn.cursor() as cur:
        cur.execute(
            "select member_code, count(*) from pledge"
            + ("" if redo else " where kind is null")
            + " group by member_code order by member_code"
        )
        targets = cur.fetchall()
    if limit:
        targets = targets[:limit]
    print(f"  대상 {len(targets)}명", file=sys.stderr)

    done = tagged = 0
    for i, (mcode, n) in enumerate(targets, 1):
        with conn.cursor() as cur:
            cur.execute(
                "select id, title, coalesce(body,'') from pledge where member_code = %s"
                + ("" if redo else " and kind is null"),
                (mcode,),
            )
            rows = cur.fetchall()
        if not rows:
            continue
        listing = "\n".join(f'{pid}. {t} / {b[:200]}' for pid, t, b in rows)

        try:
            out = llm.complete_json(
                CLASSIFY_PROMPT.replace("{items}", listing), CLASSIFY_SCHEMA)
        except llm.QuotaExhausted as e:
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  {len(targets) - i + 1}명이 남았습니다. 한도 회복 후 같은 명령을"
                  " 다시 실행하면 남은 것만 처리합니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            print(f"  [{i}/{len(targets)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        valid = {pid for pid, _, _ in rows}
        pairs = [(it["kind"], it["id"]) for it in out.get("items", [])
                 if it.get("id") in valid and it.get("kind") in KINDS]
        with conn.cursor() as cur:
            cur.executemany("update pledge set kind = %s where id = %s", pairs)
        conn.commit()
        done += 1
        tagged += len(pairs)
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 의원 {done}명 공약 {tagged}건", file=sys.stderr)

    print(f"[classify] 의원 {done}명, 공약 {tagged}건 분류", file=sys.stderr)


# --------------------------------------------------------------------------- match


def run_match(conn, limit: int | None, redo: bool) -> None:
    """입법형 공약 ↔ 본인 대표발의 법안. 공동발의는 서명일 뿐이라 근거로 쓰지 않는다."""
    with conn.cursor() as cur:
        # 이미 돌린 의원은 건너뛴다. '매칭 0건' 과 '아직 안 돌림' 을 구별해야 해서
        # 근거 유무가 아니라 실행 기록(ingest_run)으로 판단한다.
        cur.execute(
            """
            select p.member_code, count(*)
            from pledge p
            where p.kind = '입법'
              and exists (select 1 from bill_sponsor s
                           where s.member_code = p.member_code and s.role = 'rep')
              %s
            group by p.member_code order by count(*) desc
            """ % ("" if redo else
                   "and not exists (select 1 from ingest_run r"
                   " where r.source = 'match:' || p.member_code)")
        )
        targets = cur.fetchall()
    if limit:
        targets = targets[:limit]
    print(f"  대상 {len(targets)}명", file=sys.stderr)

    done = linked = 0
    for i, (mcode, n) in enumerate(targets, 1):
        with conn.cursor() as cur:
            cur.execute(
                "select id, title, coalesce(body,'') from pledge"
                " where member_code = %s and kind = '입법' order by id", (mcode,))
            pledges = cur.fetchall()
            cur.execute(
                "select bill_id, name, coalesce(proc_result,'계류') from member_bill"
                " where member_code = %s and role = 'rep' order by proposed_at desc",
                (mcode,))
            bills = cur.fetchall()
        if not pledges or not bills:
            continue

        out = None
        try:
            out = llm.complete_json(
                MATCH_PROMPT.format(
                    pledges="\n".join(f"{p}. {t} / {b[:150]}" for p, t, b in pledges),
                    bills="\n".join(f"{bid} | {nm} | {res}" for bid, nm, res in bills),
                ), MATCH_SCHEMA)
        except llm.QuotaExhausted as e:
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  {len(targets) - i + 1}명이 남았습니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            print(f"  [{i}/{len(targets)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        pids = {p for p, _, _ in pledges}
        bids = {b for b, _, _ in bills}
        rows = [
            (m["pledge_id"], "bill", m["bill_id"],
             float(m.get("confidence") or 0), (m.get("why") or "")[:300])
            for m in out.get("matches", [])
            # 없는 id 는 버린다. 모델이 지어낸 근거가 화면에 뜨면 신뢰가 무너진다.
            if m.get("pledge_id") in pids and m.get("bill_id") in bids
        ]
        with conn.cursor() as cur:
            cur.executemany(
                "insert into pledge_evidence (pledge_id, kind, ref_id, score, summary)"
                " values (%s,%s,%s,%s,%s)"
                " on conflict (pledge_id, kind, ref_id) do update set"
                "   score = excluded.score, summary = excluded.summary", rows)
            cur.execute(
                "insert into ingest_run (source, finished_at, rows)"
                " values ('match:' || %s, now(), %s)", (mcode, len(rows)))
        conn.commit()
        done += 1
        linked += len(rows)
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 의원 {done}명 근거 {linked}건", file=sys.stderr)

    print(f"[match] 의원 {done}명, 공약-법안 연결 {linked}건", file=sys.stderr)


# --------------------------------------------------------------------------- decide

# 판정 규칙. 서비스에 그대로 공개한다. 사람 판단이 아니라 표를 따르므로 재현 가능하다.
DECIDE_SQL = """
with ev as (
  select e.pledge_id,
         max(e.score) as conf,
         -- psycopg 는 주석까지 훑어 퍼센트 기호를 파라미터로 본다. 리터럴은 두 번 써야 한다.
         bool_or(b.proc_result like '%%가결%%') as passed,
         count(*) as n
  from pledge_evidence e
  join bill b on b.bill_id = e.ref_id
  where e.kind = 'bill'
  group by e.pledge_id
),
judged as (
  select p.id as pledge_id,
    case
      when p.kind <> '입법'      then '판단불가'
      when ev.passed             then '완료'
      when ev.n > 0              then '진행'
      when %(start)s::date + (%(grace)s || ' years')::interval < now() then '미착수'
      else '판단불가'
    end as status,
    case
      when p.kind <> '입법'      then 'no_measure:' || coalesce(p.kind, '미분류')
      when ev.passed             then 'law_passed'
      when ev.n > 0              then 'law_filed'
      when %(start)s::date + (%(grace)s || ' years')::interval < now() then 'law_none_2y'
      else 'law_none_early'
    end as note,
    ev.conf
  from pledge p left join ev on ev.pledge_id = p.id
  where p.kind is not null
)
insert into pledge_status (pledge_id, status, confidence, decided_by, note, updated_at)
select pledge_id, status, conf, 'auto', note, now() from judged
on conflict (pledge_id) do update set
  status = excluded.status, confidence = excluded.confidence,
  note = excluded.note, updated_at = now()
-- 사람이 확정한 판정은 절대 덮지 않는다.
where pledge_status.decided_by = 'auto'
"""


def run_decide(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(DECIDE_SQL, {"start": TERM_START, "grace": GRACE_YEARS})
        n = cur.rowcount
        cur.execute("refresh materialized view concurrently member_stats")
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("select status, note, count(*) from pledge_status"
                    " group by status, note order by count(*) desc")
        for st, note, c in cur.fetchall():
            print(f"  {st:6} {note:22} {c:6,}건", file=sys.stderr)
    print(f"[decide] {n:,}건 판정 (규칙 적용, LLM 없음)", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["classify", "match", "decide", "all"])
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--redo", action="store_true")
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        if a.step in ("classify", "all"):
            run_classify(conn, a.limit, a.redo)
        if a.step in ("match", "all"):
            run_match(conn, a.limit, a.redo)
        if a.step in ("decide", "all"):
            run_decide(conn)


if __name__ == "__main__":
    main()

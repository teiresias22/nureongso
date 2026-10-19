#!/usr/bin/env python3
"""분류·매칭 품질 검수용 표본 추출.

자동 분류를 믿기 전에 사람이 직접 보고 맞는지 확인한다. 유형별로 고르게 뽑아
한쪽 유형만 잘 맞는 상황을 놓치지 않는다.

    python sample_review.py kind   [--n 30]   # 공약 유형 분류 표본
    python sample_review.py match  [--n 30]   # 공약-법안 연결 표본
    python sample_review.py gold --layer done|bid|none [--n 30] [--seed gold-v1]
                                              # 정답 표본 CSV(docs/review/). 사람이 사실 칸만 채운다
    python sample_review.py score             # 채운 정답 표본으로 정밀도·위음성률(Wilson 95%)
    python sample_review.py apply [--yes]     # 채운 라벨을 운영 근거의 review 로 반영(T1.8). --yes 없으면 전이표만
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import sys

from collections import Counter

import psycopg

import judge

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
       b.name as bill_name, coalesce(b.proc_result, '계류') as result, e.quote, e.quote_ok
from pledge_evidence e
join pledge p on p.id = e.pledge_id
join member m on m.code = p.member_code
join bill b on b.bill_id = e.ref_id
where e.kind = 'bill'
order by md5(e.pledge_id::text || e.ref_id)
limit %(n)s
"""


# ---------------------------------------------------------------- 정답 표본(gold, 판정 계획 T0.6)
# 사람이 채우는 칸은 사실만이다: 근거가 그 공약의 이행 기록이 맞는가, 놓친 기록, 범위·공포, 이전 단계 공고.
# AI 초안은 저장소 밖에 둔다 — 공개 CSV 에는 사람 라벨만 들어간다. 층을 섞어 비율을 내지 않는다.
REVIEW_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "review")
HEADER = ("# 정답 표본 — 사실 라벨만. 의견·평가를 적지 않는다. label: ok(그 공약의 이행 기록이 맞음)|wrong · "
          "missed: 놓친 기록 kind:ref(여럿이면 공백) · scope: 전부|일부 · enacted: 예|아니오 · prior: 예|아니오 "
          "(같은 사업의 이전 단계 공고·설계용역이 2026-07-01 전에 있음) · reviewer · reviewed_at YYYY-MM-DD")
COLS = ["layer", "pledge_id", "member_code", "election_id", "title", "status", "note", "rule",
        "ev", "ev_name", "ev_date", "ev_result", "ev_score", "ev_why", "candidates",
        "label", "missed", "scope", "enacted", "prior", "reviewer", "reviewed_at"]

# 층마다 모집단. 순서는 md5(id || seed) 라 다시 뽑아도 같다.
LAYERS = {
    # 완료 판정 전부(35)
    "done": "s.status = '완료'",
    # 임기 중(취임 뒤) 공고가 붙은 발주 진행
    "bid": """s.note = 'bid_ordered' and exists (select 1 from pledge_evidence e join bid_notice n on n.id = e.ref_id
              where e.pledge_id = p.id and e.kind = 'bid' and n.notice_at >= %(head_start)s::date)""",
    # R1·R2 뒤에도 미착수로 남는 몫: 22대 총선 입법 단독 공약
    "none": "s.note = 'none_2y' and p.kinds = array['입법'] and p.election_id = '20240410'",
}

GOLD_SQL = """
select p.id, p.member_code, p.election_id, p.title, s.status, s.note
from pledge p join pledge_status s on s.pledge_id = p.id
where {where}
order by md5(p.id::text || %(seed)s)
limit %(n)s
"""

EV_SQL = """
select e.kind || ':' || e.ref_id,
       coalesce(b.name, o.name, n.name),
       coalesce(b.proposed_at::text, o.announced_at, n.notice_at::text),
       coalesce(b.proc_result, o.rr_kind, ''),
       e.score, coalesce(e.summary, '')
from pledge_evidence e
left join bill b on e.kind = 'bill' and b.bill_id = e.ref_id
left join ordinance o on e.kind = 'ordin' and o.id = e.ref_id
left join bid_notice n on e.kind = 'bid' and n.id = e.ref_id
where e.pledge_id = %(pid)s order by e.kind, e.ref_id
"""

# 미착수 층: 그 사람의 임기 중 대표발의 전부를 공약 제목과 닮은 순으로. 사람이 놓친 것을 찾는 목록이다.
CAND_SQL = """
select string_agg(b.bill_id || ' ' || b.name || ' [' || coalesce(b.proc_result, '계류') || ']', ' ;; '
                  order by word_similarity(%(title)s, b.name) desc, b.bill_id)
from bill_sponsor sp join bill b on b.bill_id = sp.bill_id
where sp.member_code = %(code)s and sp.role = 'rep' and b.proposed_at >= to_date(%(el)s, 'YYYYMMDD')
"""


def run_gold(cur, layer: str, n: int, seed: str) -> str:
    cur.execute(GOLD_SQL.format(where=LAYERS[layer]), judge.PARAMS | {"seed": seed, "n": n})
    rows = []
    for pid, code, el, title, st, note in cur.fetchall():
        base = {"layer": layer, "pledge_id": pid, "member_code": code, "election_id": el, "title": title,
                "status": st, "note": note, "rule": judge.RULE_VERSION}
        cur.execute(EV_SQL, {"pid": pid})
        evs = cur.fetchall()
        cand = ""
        if layer == "none":
            cur.execute(CAND_SQL, {"title": title, "code": code, "el": el})
            cand = cur.fetchone()[0] or ""
        # 근거마다 한 줄(그 근거에 ok|wrong). 근거 없는 공약은 한 줄(missed 를 채운다).
        for ev in evs or [None]:
            r = dict(base, candidates=cand)
            if ev:
                r.update(zip(["ev", "ev_name", "ev_date", "ev_result", "ev_score", "ev_why"], ev))
            rows.append(r)
    os.makedirs(REVIEW_DIR, exist_ok=True)
    path = os.path.join(REVIEW_DIR, f"{seed}-{layer}.csv")
    if os.path.exists(path):
        sys.exit(f"{path} 가 이미 있다. 라벨을 덮지 않는다 — 지우거나 다른 --seed 로.")
    with open(path, "w", newline="") as f:
        f.write(HEADER + "\n")
        w = csv.DictWriter(f, COLS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"[gold] {layer} 공약 {len({r['pledge_id'] for r in rows})}건 · {len(rows)}줄 → {path}", file=sys.stderr)
    return path


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """이항 비율 k/n 의 Wilson 95% 구간. n=0 이면 (0, 1)."""
    if n == 0:
        return 0.0, 1.0
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def read_gold(path: str) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(line for line in f if not line.startswith("#")))


def score_gold(rows: list[dict]) -> list[str]:
    """층마다 따로. 사람이 채운 줄만 센다."""
    out = []
    fmt = lambda name, k, n: f"  {name}: {k}/{n}" + (" ({:.0%}, {:.0%}~{:.0%})".format(k / n, *wilson(k, n)) if n else "")
    for layer in sorted({r["layer"] for r in rows}):
        rs = [r for r in rows if r["layer"] == layer]
        out.append(f"[{layer}]")
        for kind in sorted({r["ev"].split(":")[0] for r in rs if r["ev"]}):
            lab = [r for r in rs if r["ev"].startswith(kind + ":") and r["label"] in ("ok", "wrong")]
            out.append(fmt(f"근거 정밀도 {kind}", sum(r["label"] == "ok" for r in lab), len(lab)))
        by = {}
        for r in rs:
            by.setdefault(r["pledge_id"], []).append(r)
        if layer == "done":
            done = [g for g in by.values() if g[0]["scope"] and g[0]["enacted"]]
            ok = sum(any(r["label"] == "ok" for r in g) and g[0]["scope"] == "전부" and g[0]["enacted"] == "예"
                     for g in done)
            out.append(fmt("완료 정밀도(맞는 근거·전부·공포)", ok, len(done)))
        if layer == "none":
            seen = [g for g in by.values() if g[0]["reviewed_at"]]
            out.append(fmt("미착수 위음성률(놓친 기록 있음)", sum(bool(g[0]["missed"].strip()) for g in seen), len(seen)))
        if layer == "bid":
            seen = [g for g in by.values() if g[0]["prior"] in ("예", "아니오")]
            out.append(fmt("이전 단계 공고 있음(prior, 결정 J 기준 1)", sum(g[0]["prior"] == "예" for g in seen), len(seen)))
            sc = [g for g in by.values() if g[0]["scope"] in ("전부", "일부")]
            out.append(fmt("공고가 공약 전부를 다룸(scope)", sum(g[0]["scope"] == "전부" for g in sc), len(sc)))
        who = sorted({r["reviewer"] for r in rs if r["reviewed_at"]})
        if who:
            out.append("  라벨: " + ", ".join(who))
    return out


# ---------------------------------------------------------------- 검수 반영(판정 계획 T1.8)
# 라벨 → pledge_evidence.review. 판정은 늘 규칙표(DECIDE_SQL)가 낸다 — 여기서는 근거에 표시만 단다(결정 M).
# reviewer 가 'Claude' 인 줄은 LLM 라벨이라 review 끝에 ':llm', 이력 사유도 'llm' 으로 사람 검수와 가른다.
LLM_REVIEWER = "Claude"


def plan_marks(rows: list[dict]) -> dict[bool, tuple[dict, list]]:
    """{llm 여부: ({(pid, kind, ref): review}, [(pid, kind, ref, model, review) 추가할 근거])}. DB 없이 계산한다."""
    out = {False: ({}, []), True: ({}, [])}
    for r in rows:
        if not r["reviewed_at"]:
            continue
        llm = r["reviewer"].strip() == LLM_REVIEWER
        tail = f"{r['reviewed_at']}{':llm' if llm else ''}"
        marks, adds = out[llm]
        pid = int(r["pledge_id"])
        held = r["scope"] == "일부" or r["enacted"] == "아니오"
        if r["ev"] and r["label"] in ("ok", "wrong"):
            kind, ref = r["ev"].split(":", 1)
            verb = "reject" if r["label"] == "wrong" else "partial" if held else "ok"
            marks[(pid, kind, ref)] = f"{verb}:{tail}"
        for m in r["missed"].split():
            kind, ref = m.split(":", 1)
            add = (pid, kind, ref, f"{'llm-reviewer' if llm else 'reviewer'}:{r['reviewed_at']}", f"ok:{tail}")
            if add not in adds:
                adds.append(add)
    return out


def run_apply(conn, rows: list[dict], yes: bool) -> None:
    judge.wait_ingest(conn, "검수를 반영하지")
    judge.run_snapshot(conn)  # 원천 변화부터 따로 커밋한다(정기 단계와 같은 쓰기)
    with conn.cursor() as cur:
        last = judge.applied_rule(cur)
        if last is not None and last[0] != judge.RULE_VERSION:
            sys.exit(f"규칙 판 미적용 — 마지막 적용 {last[0]}, 지금 {judge.RULE_VERSION}. decide --rule 먼저")
        cur.execute("select set_config('judge.rule', %s, true)", (judge.RULE_VERSION,))
        # 쌓인 입력 변화를 보통 사유로 먼저 털어 낸다. 그래야 아래 변화가 전부 검수 사유가 된다.
        cur.execute(judge.DECIDE_SQL, judge.PARAMS)
        flushed = cur.rowcount
        cur.execute("create temp table before_apply on commit drop as select pledge_id, status, note from pledge_status")
        for llm, (marks, adds) in plan_marks(rows).items():
            if not marks and not adds:
                continue
            cur.execute("select set_config('judge.reason', %s, true)", ("llm" if llm else "reviewer",))
            # LLM 은 사람이 단 표시를 덮지 않는다. 같은 값은 다시 쓰지 않는다(Disk IO).
            keep = " and (review is null or review like '%%:llm')" if llm else ""
            hit = miss = 0
            for (pid, kind, ref), rv in marks.items():
                cur.execute("update pledge_evidence set review = %s where pledge_id = %s and kind = %s and ref_id = %s"
                            " and review is distinct from %s" + keep, (rv, pid, kind, ref, rv))
                hit += cur.rowcount
                if not cur.rowcount:
                    cur.execute("select 1 from pledge_evidence where pledge_id = %s and kind = %s and ref_id = %s",
                                (pid, kind, ref))
                    miss += cur.fetchone() is None
            for pid, kind, ref, model, rv in adds:
                cur.execute("insert into pledge_evidence (pledge_id, kind, ref_id, score, summary, model, review)"
                            " values (%s, %s, %s, 1, '검수 때 추가', %s, %s) on conflict (pledge_id, kind, ref_id) do update"
                            " set review = excluded.review where pledge_evidence.review is null"
                            + (" or pledge_evidence.review like '%%:llm'" if llm else ""),
                            (pid, kind, ref, model, rv))
                hit += cur.rowcount
            cur.execute(judge.DECIDE_SQL, judge.PARAMS)
            print(f"[apply] {'LLM' if llm else '사람'} 검수: 표시 {hit}건(근거가 사라져 못 단 것 {miss}) · 판정 {cur.rowcount}건",
                  file=sys.stderr)
        cur.execute("select b.status, b.note, s.status, s.note from before_apply b join pledge_status s using (pledge_id)"
                    " where (b.status, b.note) is distinct from (s.status, s.note)")
        moves = Counter((f"{a}({an})", f"{c}({cn})") for a, an, c, cn in cur.fetchall())
        print(f"[apply] 먼저 털어 낸 입력 변화 {flushed}건. 검수로 바뀐 판정 {sum(moves.values())}건:", file=sys.stderr)
        for (a, c), n in moves.most_common():
            print(f"  {a:28} → {c:28} {n:4}건", file=sys.stderr)
        if not yes:
            conn.rollback()
            print("[apply] 미리보기만 하고 되돌렸다. 반영하려면 --yes", file=sys.stderr)
            return
        if moves:
            cur.execute("refresh materialized view concurrently member_stats")
    conn.commit()
    print("[apply] 반영했다", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["kind", "match", "gold", "score", "apply"])
    ap.add_argument("--n", type=int, default=30)
    ap.add_argument("--layer", choices=sorted(LAYERS))
    ap.add_argument("--seed", default="gold-v1")
    ap.add_argument("--yes", action="store_true", help="apply: 미리보기 대신 반영한다")
    # 라벨 CSV 는 위 브랜치에 있고 apply 는 적용된 판의 코드로 돌아야 해서 경로를 따로 받는다.
    ap.add_argument("--dir", default=REVIEW_DIR, help="apply: 라벨 CSV 폴더")
    a = ap.parse_args()

    if a.what == "score":  # DB 없이 CSV 만 읽는다
        rows = [r for f in sorted(os.listdir(REVIEW_DIR)) if f.endswith(".csv")
                for r in read_gold(os.path.join(REVIEW_DIR, f))]
        print("\n".join(score_gold(rows)) or "채운 표본이 없다")
        return
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")

    if a.what == "apply":
        rows = [r for f in sorted(os.listdir(a.dir)) if f.endswith(".csv")
                for r in read_gold(os.path.join(a.dir, f))]
        with psycopg.connect(dsn) as c:
            run_apply(c, rows, a.yes)
        return
    with psycopg.connect(dsn) as c, c.cursor() as cur:
        if a.what == "gold":
            if not a.layer:
                sys.exit("--layer done|bid|none")
            run_gold(cur, a.layer, a.n, a.seed)
        elif a.what == "kind":
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
            for name, title, score, why, bill, result, quote, ok in cur.fetchall():
                print(f"{name} | 신뢰도 {score}")
                print(f"  공약: {title}")
                print(f"  법안: {bill} [{result}]")
                print(f"  이유: {why}")
                # 원문 구절(judge.py quote). ok=False 면 모델이 고른 글이 원문에 없거나 '해당 없음' 이다.
                if ok is not None:
                    print(f"  구절: {'원문 확인' if ok else '원문에 없음'} {quote!r}")


if __name__ == "__main__":
    main()

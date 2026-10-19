#!/usr/bin/env python3
"""판정 분기 점검 — 규칙표(judge.JUDGED_CTE)가 경우마다 정해진 판정을 내는지.

운영 DB 에서 begin … rollback 안에서만 돈다. ZZ 로 시작하는 가짜 사람·공약·근거를 넣고 판정 부분만
SELECT 한다. pledge_status 를 쓰지 않아 판정 이력 트리거도 돌지 않는다. 남는 것이 없다.

    cd collector && dotenvx run -- .venv/bin/python decide_check.py

규칙을 바꾸는 커밋에서 돌린다. 기대값(CASES)의 diff 가 곧 규칙 변경의 명세다(계획 3.0 절차 R).
기대와 다른 경우를 찍고 1 로 끝난다.
"""
from __future__ import annotations

import os
import sys

import psycopg

import judge

MP, HEAD = "국회의원", "구시군의장"

# (번호, 설명, 직위, 당선 선거들[(선거일, 당선[, 그 선거의 직위])], 공약 선거일, 유형, 대조 기록, 근거들, 기대 (상태, note))
# 근거: ("bill", 발의일, 처리결과, 대안 처리결과|None[, review]) · ("ordin", 공포일) · ("bid", 공고일)
# 대안 처리결과: "-" 면 대안반영폐기인데 대안을 못 이은 것.
CASES = [
    (1, "2024 국회의원·입법·본인 법안 가결", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "원안가결", None)], ("완료", "law_passed")),
    (2, "1과 같되 예산사업+입법", MP, [("20240410", True)], "20240410", ["예산사업", "입법"], ["match"],
     [("bill", "2024-07-01", "원안가결", None)], ("진행", "partial:예산사업")),
    (3, "대안반영폐기, 대안 가결", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "대안반영폐기", "원안가결")], ("완료", "law_merged")),
    (4, "대안 미연결", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "대안반영폐기", "-")], ("진행", "law_alt_unverified")),
    (5, "계류", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", None, None)], ("진행", "law_filed")),
    (6, "선거일 전 법안만, 대조 기록 있음, 입법 단독", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-01-01", "원안가결", None)], ("미착수", "none_2y")),
    (7, "대조 기록 없음", MP, [("20240410", True)], "20240410", ["입법"], [], [], ("판단불가", "not_checked")),
    (8, "2026-06-03 재보궐 국회의원, 근거 없음", MP, [("20260603", True)], "20260603", ["입법"], ["match"], [],
     ("판단불가", "none_early")),                 # T1.2: 재보궐은 선거일부터 2년. 2028-06-03 이 22대 임기 끝 뒤라 T5.2 가 정한다
    (9, "낙선 후보 입법 공약", MP, [("20240410", False)], "20240410", ["입법"], [], [],
     ("판단불가", "not_elected")),                # T1.3: 낙선 공약은 판정하지 않음
    (10, "비현직 의원의 2020 공약", MP, [("20200415", True)], "20200415", ["입법"], [], [],
     ("판단불가", "past_term")),                  # T1.3: 22대 전 국회의원 공약
    (11, "단체장 조례제도, 2026-08 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260815")], ("완료", "ordin_enacted")),
    (12, "단체장 조례제도, 2026-06-30 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260630")], ("판단불가", "none_early")),  # T1.1: 취임 전 공포는 근거 아님
    (13, "단체장 예산사업, 2025 공고만", HEAD, [("20260603", True)], "20260603", ["예산사업"], [],
     [("bid", "2025-05-01")], ("판단불가", "no_measure:예산사업")),  # T1.1: 선거 전 공고는 근거 아님
    (14, "단체장 예산사업, 2026-08 공고", HEAD, [("20260603", True)], "20260603", ["예산사업"], [],
     [("bid", "2026-08-10")], ("진행", "bid_ordered")),     # T2.2(J-B) → no_measure:예산사업
    (15, "단체장 입법 단독", HEAD, [("20260603", True)], "20260603", ["입법"], [], [],
     ("판단불가", "no_measure:입법")),            # T1.4: 국회 입법은 단체장이 할 수 있는 일이 아님
    (16, "가결 법안 근거 review='reject:…'", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "원안가결", None, "reject:2026-10-18")], ("미착수", "none_2y")),   # T1.1: 사람이 관련 없다고 확인
    (17, "선언", MP, [("20240410", True)], "20240410", ["선언"], ["match"], [], ("판단불가", "no_measure:선언")),
    (18, "국회의원 예산사업+입법, 근거 없음, 2년 지남", MP, [("20240410", True)], "20240410", ["예산사업", "입법"],
     ["match"], [], ("미착수", "none_2y")),       # T2.1(K-B) → 판단불가 none_partial
    (19, "가결 법안 근거 review='partial:…'", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "원안가결", None, "partial:2026-10-18")], ("진행", "review_partial")),  # T1.1: 사람이 일부만으로 확인
    (20, "철회 법안만, 입법 단독, 2년 지남", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "철회", None)], ("미착수", "law_withdrawn")),   # T1.5: 철회는 착수 기록이 아님
    (21, "단체장 조례, 2026-07-01 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260701")], ("완료", "ordin_enacted")),   # T2.3(L) → 판단불가 none_early
    (22, "낙선 후보 예산사업 공약", MP, [("20240410", False)], "20240410", ["예산사업"], [], [],
     ("판단불가", "not_elected")),                # T1.3
    (23, "부결 법안만", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "부결", None)], ("진행", "law_filed")),   # 결정 W 권고: 폐기와 같이 진행
    (24, "지금 단체장인 사람의 2020 국회의원 선거 조례제도 공약(당선)", HEAD,
     [("20200415", True, MP), ("20260603", True)], "20200415", ["조례제도"], [], [],
     ("판단불가", "no_measure:조례제도")),        # T1.3: 그 선거의 직위(국회의원)로는 조례를 못 잰다
]
# 근거 끝에 review 값을 붙일 수 있다(16·19). pledge_evidence.review 칸이 없는 DB(결정 F 전)면 그 경우는 건너뛴다.


def has_review(cur) -> bool:
    cur.execute("select exists (select 1 from information_schema.columns"
                " where table_name = 'pledge_evidence' and column_name = 'review')")
    return cur.fetchone()[0]


def cases(cur) -> list[tuple]:
    if has_review(cur):
        return CASES
    return [c for c in CASES if not any(len(ev) > 4 for ev in c[7])]


def load(cur) -> dict[int, int]:
    """경우마다 가짜 사람·공약·근거를 넣고 {경우 번호: pledge_id}."""
    ids = {}
    for no, _, office, runs, el, kinds, checked, evs, _ in cases(cur):
        code = f"ZZDC{no:02d}"
        cur.execute("insert into member (code, name, office) values (%s, %s, %s)", (code, f"점검{no}", office))
        for sg, won, *cand_office in runs:   # 그 선거의 직위(없으면 지금 직위)
            cur.execute("insert into candidacy (member_code, election_id, elected, office) values (%s, %s, %s, %s)",
                        (code, sg, won, (cand_office or [office])[0]))
        cur.execute("insert into pledge (member_code, election_id, title, order_no, kinds)"
                    " values (%s, %s, %s, 1, %s) returning id", (code, el, f"점검 공약 {no}", kinds))
        pid = cur.fetchone()[0]
        ids[no] = pid
        for step in checked:
            cur.execute("insert into ingest_run (source, finished_at, rows) values (%s, now(), 0)", (f"{step}:{code}",))
        for k, ev in enumerate(evs):
            ref = f"ZZDC{no:02d}-{k}"
            if ev[0] == "bill":
                _, at, result, alt = ev[:4]
                alt_id = None
                if alt and alt != "-":
                    alt_id = ref + "-alt"
                    cur.execute("insert into bill (bill_id, age, name, proc_result, proposed_at)"
                                " values (%s, 22, '점검 대안', %s, %s)", (alt_id, alt, at))
                cur.execute("insert into bill (bill_id, age, name, proc_result, proposed_at, alt_bill_id)"
                            " values (%s, 22, '점검 법안', %s, %s, %s)", (ref, result, at, alt_id))
            elif ev[0] == "ordin":
                cur.execute("insert into ordinance (id, name, announced_at) values (%s, '점검 조례', %s)", (ref, ev[1]))
            else:
                cur.execute("insert into bid_notice (id, name, notice_at) values (%s, '점검 공고', %s)", (ref, ev[1]))
            cur.execute("insert into pledge_evidence (pledge_id, kind, ref_id, score) values (%s, %s, %s, 0.9)",
                        (pid, ev[0], ref))
            if len(ev) > 4:
                cur.execute("update pledge_evidence set review = %s where pledge_id = %s and ref_id = %s",
                            (ev[4], pid, ref))
    return ids


def check(conn, cte: str = judge.JUDGED_CTE) -> list[str]:
    """기대와 다른 경우의 설명 목록(끝에 본 경우 수). 언제나 롤백한다."""
    try:
        with conn.cursor() as cur:
            ids = load(cur)
            cur.execute(cte + " select pledge_id, status, note from judged where pledge_id = any(%(ids)s)",
                        judge.PARAMS | {"ids": list(ids.values())})
            got = {pid: (st, note) for pid, st, note in cur.fetchall()}
            if has_review(cur):
                # 사람이 표시한 근거는 재대조가 덮지 않는다(T0.5): 16번 근거에 다른 점수·이유를 넣어 본다.
                ref = "ZZDC16-0"
                model_id, judge.llm.model_id = judge.llm.model_id, lambda: "gemini:check"  # 모델 목록을 부르지 않게
                try:
                    judge.save_evidence(cur, [(ids[16], "bill", ref, 0.1, "다른 이유")], "match:test")
                finally:
                    judge.llm.model_id = model_id
                cur.execute("select score::float, summary from pledge_evidence where ref_id = %s", (ref,))
                if cur.fetchone() != (0.9, None):
                    got["guard"] = "덮어씀"
            used = cases(cur)
    finally:
        conn.rollback()
    bad = ["  검수 표시 근거를 save_evidence 가 덮었다"] if got.get("guard") else []
    for no, label, *_, want in used:
        have = got.get(ids[no])
        if have != want:
            bad.append(f"  {no:2}. {label}: 기대 {want[0]}·{want[1]} / 실제 {have}")
    check.seen = len(used)
    return bad


def main():
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        bad = check(conn)
    if bad:
        print(f"[decide_check] {len(bad)}건이 기대와 다르다 (규칙 판 {judge.RULE_VERSION})", file=sys.stderr)
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)
    skipped = len(CASES) - check.seen
    print(f"[decide_check] {check.seen}건 모두 기대대로 (규칙 판 {judge.RULE_VERSION})"
          + (f" · review 칸이 없어 {skipped}건 건너뜀" if skipped else ""), file=sys.stderr)


if __name__ == "__main__":
    main()

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

# (번호, 설명, 직위, 당선 선거들[(선거일, 당선)], 공약 선거일, 유형, 대조 기록, 근거들, 기대 (상태, note))
# 근거: ("bill", 발의일, 처리결과, 대안 처리결과|None) · ("ordin", 공포일) · ("bid", 공고일)
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
     ("미착수", "none_2y")),                      # T1.2 → 판단불가 none_early
    (9, "낙선 후보 입법 공약", MP, [("20240410", False)], "20240410", ["입법"], [], [],
     ("판단불가", "not_checked")),                # T1.3 → not_elected
    (10, "비현직 의원의 2020 공약", MP, [("20200415", True)], "20200415", ["입법"], [], [],
     ("판단불가", "not_checked")),                # T1.3 → past_term
    (11, "단체장 조례제도, 2026-08 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260815")], ("완료", "ordin_enacted")),
    (12, "단체장 조례제도, 2026-06-30 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260630")], ("완료", "ordin_enacted")),   # T1.1 → 판단불가 none_early
    (13, "단체장 예산사업, 2025 공고만", HEAD, [("20260603", True)], "20260603", ["예산사업"], [],
     [("bid", "2025-05-01")], ("진행", "bid_ordered")),     # T1.1 → no_measure:예산사업
    (14, "단체장 예산사업, 2026-08 공고", HEAD, [("20260603", True)], "20260603", ["예산사업"], [],
     [("bid", "2026-08-10")], ("진행", "bid_ordered")),     # T2.2(J-B) → no_measure:예산사업
    (15, "단체장 입법 단독", HEAD, [("20260603", True)], "20260603", ["입법"], [], [],
     ("판단불가", "not_checked")),                # T1.4 → no_measure:입법
    (17, "선언", MP, [("20240410", True)], "20240410", ["선언"], ["match"], [], ("판단불가", "no_measure:선언")),
    (18, "국회의원 예산사업+입법, 근거 없음, 2년 지남", MP, [("20240410", True)], "20240410", ["예산사업", "입법"],
     ["match"], [], ("미착수", "none_2y")),       # T2.1(K-B) → 판단불가 none_partial
    (20, "철회 법안만, 입법 단독, 2년 지남", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "철회", None)], ("진행", "law_filed")),   # T1.5 → 미착수 law_withdrawn
    (21, "단체장 조례, 2026-07-01 공포", HEAD, [("20260603", True)], "20260603", ["조례제도"], ["ordin"],
     [("ordin", "20260701")], ("완료", "ordin_enacted")),   # T2.3(L) → 판단불가 none_early
    (22, "낙선 후보 예산사업 공약", MP, [("20240410", False)], "20240410", ["예산사업"], [], [],
     ("판단불가", "no_measure:예산사업")),        # T1.3 → not_elected
    (23, "부결 법안만", MP, [("20240410", True)], "20240410", ["입법"], ["match"],
     [("bill", "2024-07-01", "부결", None)], ("진행", "law_filed")),   # 결정 W 권고: 폐기와 같이 진행
    (24, "지금 단체장인 사람의 2020 국회의원 선거 조례제도 공약(당선)", HEAD,
     [("20200415", True), ("20260603", True)], "20200415", ["조례제도"], [], [],
     ("판단불가", "past_term")),                  # T1.3 → no_measure:조례제도
]
# 16·19(근거 review 표시)는 pledge_evidence.review 칸(T0.5) 뒤에 넣는다.


def load(cur) -> dict[int, int]:
    """경우마다 가짜 사람·공약·근거를 넣고 {경우 번호: pledge_id}."""
    ids = {}
    for no, _, office, runs, el, kinds, checked, evs, _ in CASES:
        code = f"ZZDC{no:02d}"
        cur.execute("insert into member (code, name, office) values (%s, %s, %s)", (code, f"점검{no}", office))
        for sg, won in runs:
            cur.execute("insert into candidacy (member_code, election_id, elected) values (%s, %s, %s)",
                        (code, sg, won))
        cur.execute("insert into pledge (member_code, election_id, title, order_no, kinds)"
                    " values (%s, %s, %s, 1, %s) returning id", (code, el, f"점검 공약 {no}", kinds))
        pid = cur.fetchone()[0]
        ids[no] = pid
        for step in checked:
            cur.execute("insert into ingest_run (source, finished_at, rows) values (%s, now(), 0)", (f"{step}:{code}",))
        for k, ev in enumerate(evs):
            ref = f"ZZDC{no:02d}-{k}"
            if ev[0] == "bill":
                _, at, result, alt = ev
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
    return ids


def check(conn, cte: str = judge.JUDGED_CTE) -> list[str]:
    """기대와 다른 경우의 설명 목록. 언제나 롤백한다."""
    try:
        with conn.cursor() as cur:
            ids = load(cur)
            cur.execute(cte + " select pledge_id, status, note from judged where pledge_id = any(%(ids)s)",
                        judge.PARAMS | {"ids": list(ids.values())})
            got = {pid: (st, note) for pid, st, note in cur.fetchall()}
    finally:
        conn.rollback()
    bad = []
    for no, label, *_, want in CASES:
        have = got.get(ids[no])
        if have != want:
            bad.append(f"  {no:2}. {label}: 기대 {want[0]}·{want[1]} / 실제 {have}")
    return bad


def main():
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        bad = check(conn)
    if bad:
        print(f"[decide_check] {len(bad)}/{len(CASES)}건이 기대와 다르다 (규칙 판 {judge.RULE_VERSION})", file=sys.stderr)
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)
    print(f"[decide_check] {len(CASES)}건 모두 기대대로 (규칙 판 {judge.RULE_VERSION})", file=sys.stderr)


if __name__ == "__main__":
    main()

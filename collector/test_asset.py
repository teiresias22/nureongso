"""국회공보 재산공개 파서. 원문 발췌를 줄여 붙였다 (숫자는 실제 공보 그대로)."""
import datetime as dt

from asset import age_at, link, match, parse

REGULAR = ["""2025년 정기재산변동신고 공개목록
1. 국회의원
소속 국회 직위 국회의장 성명 우원식
(단위 : 천원)
▶ 토지(소계) 695,670 2,811 1,124 697,357
▶ 건물(소계) 1,750,136 30,000 59,168 1,720,968
▶ 예금(소계) 187,275 133,719 24,230 296,764
▶ 채무(소계) 160,000 0 0 160,000
▶ 고지거부 및 등록제외사항 - - - -
장남 고지거부 0 0 0 0 독립생계유지
증감액: 80,579천원
총 계 2,551,815 176,881 96,302 2,632,394
""", """소속 국회 직위 수석전문위원 성명 홍길동
총 계 100 0 0 100
소속 국회 직위 국회의원 성명 강경숙
▶ 예금(소계) 10 5 -3 18
총 계 10 5 -3 18
"""]

NEW = ["""◇ 제22대국회 신규등록 국회의원(2024. 5.30. 기준)
1. 제22대 국회의원(최초)
소속 국회 직위 국회의원 성명 강경숙
▶ 건물(소계) 674,524
총 계 674,524
2. 제22대 국회의원(재등록)
소속 국회 직위 국회의원 성명 고민정
총 계 731,079 65,078 77,836 718,321 증감액: -12,758천원
◇ 제21대국회 퇴직 국회의원(2024. 5.29. 기준)
소속 국회 직위 (전)국회의원 성명 강기윤
총 계 1 0 0 1
"""]


def test_regular() -> None:
    rows = parse(REGULAR, "2025-03-27", regular=True)
    # 1급 공무원은 빼고 의원만
    assert [r["name"] for r in rows] == ["우원식", "강경숙"]
    r = rows[0]
    assert (r["total_prev_k"], r["total_inc_k"], r["total_dec_k"], r["total_now_k"]) == (
        2551815, 176881, 96302, 2632394)
    assert r["kind"] == "정기" and r["age"] == 22 and r["page"] == 1
    # 고지거부 소계는 '- - - -' 라 항목에서 빠진다
    assert r["breakdown"] == {"토지": 697357, "건물": 1720968, "예금": 296764, "채무": 160000}
    assert r["refused"] == ["장남"]
    # 감소액이 음수로 오기도 한다
    assert rows[1]["total_dec_k"] == -3 and rows[1]["page"] == 2


def test_new_registration() -> None:
    rows = parse(NEW, "2024-08-29", regular=False)
    kinds = {r["name"]: (r["kind"], r["age"]) for r in rows}
    assert kinds == {"강경숙": ("최초", 22), "고민정": ("재등록", 22), "강기윤": ("퇴직", 21)}
    assert rows[0]["total_prev_k"] is None and rows[0]["total_now_k"] == 674524
    # 재등록은 총계 뒤에 증감액 문구가 붙는다
    assert rows[1]["total_now_k"] == 718321


def test_age() -> None:
    assert age_at(dt.date(2024, 3, 28)) == 21   # 총선 전 정기공개는 아직 21대
    assert age_at(dt.date(2024, 8, 29)) == 22
    assert age_at(dt.date(2020, 8, 28)) == 21


def test_match() -> None:
    members = [("A", "김철수", "제21대", "서울 종로구", None, None),
               ("B", "김철수", "제22대", "서울 종로구", None, None),
               ("C", "김병욱", "제21대", "경기 성남시분당구을", None, None),
               ("D", "김병욱", "제21대", "경북 포항시남구울릉군", None, None),
               ("E", "이수진", "제21대", "비례대표", "李壽珍", None),
               ("F", "이수진", "제21대", "서울 동작구을", "李秀眞", None),
               ("G", "박지원", "제14대, 제22대", "해남군완도군진도군", None, "20080409"),
               ("H", "박지원", "제22대", "군산시김제시부안군을", None, "20260603")]
    assert match(members, "김철수", 22) == "B"
    # 같은 대에 동명이인이면 공보가 붙인 괄호로 가른다 — 지역구든 한자든
    assert match(members, "김병욱", 21, "경기 성남시분당구을") == "C"
    assert match(members, "김병욱", 21, "경북 포항시남구울릉군") == "D"
    assert match(members, "이수진", 21, "비례대표") == "E"
    assert match(members, "이수진", 21, "李秀眞") == "F"
    # 괄호가 없으면 공고일 뒤에 당선된 사람을 뺀다
    assert match(members, "박지원", 22, None, "2026-03-26") == "G"
    # 그래도 둘이면 고르지 않는다
    assert match(members, "박지원", 22, None, "2026-08-27") is None
    assert match(members, "김병욱", 21) is None
    assert match(members, "박없음", 22) is None


def test_name_hint() -> None:
    rows = parse(["소속 국회 직위 (전)국회의원 성명 김병욱(경기 성남시분당구을)\n총 계 1\n"],
                 "2024-08-29", regular=False)
    assert (rows[0]["name"], rows[0]["hint"]) == ("김병욱", "경기 성남시분당구을")


def test_first_registration() -> None:
    # 21대 김병욱 둘 중 한 명은 20대부터라 2020-08 공보의 '최초' 일 수 없다.
    members = [("A", "김병욱", "제20대, 제21대", "경기 성남시분당구을", None, "20160413"),
               ("B", "김병욱", "제21대", "경북 포항시남구울릉군", None, "20200415")]
    assert match(members, "김병욱", 21, None, "2020-08-28", "최초") == "B"
    assert match(members, "김병욱", 21, None, "2021-03-25", "정기") is None


def test_link_dedupe_and_chain() -> None:
    # 2021 공보에 괄호 없는 이수진이 둘. 비례대표 이수진(P)은 21대 비례 당선 기록이 빠져
    # 첫 당선이 2024 로 잡힌다 — 공고일 규칙만 쓰면 둘 다 동작구을(D)에게 붙는다.
    members = [("P", "이수진", "제21대, 제22대", "경기 성남시중원구", "李壽珍", "20240410"),
               ("D", "이수진", "제21대", "서울 동작구을", "李秀眞", "20200415")]
    row = lambda pdf, seq, name, date, prev, now, kind="정기": dict(
        pdf_id=pdf, seq=seq, name=name, age=21, kind=kind, notice_date=date,
        total_prev_k=prev, total_now_k=now)
    rows = [
        row(1, 1, "이수진(李壽珍)", "2020-08-28", None, 1195678, "최초"),
        row(1, 2, "이수진(李秀眞)", "2020-08-28", None, 500000, "최초"),
        row(2, 1, "이수진", "2021-03-25", 1195678, 2894782),   # P 의 다음 해
        row(2, 2, "이수진", "2021-03-25", 500000, 690902),     # D 의 다음 해
        row(3, 1, "이수진(비례대표)", "2022-03-31", 2894782, 3000000),
        row(3, 2, "이수진(서울 동작구을)", "2022-03-31", 690902, 700000),
    ]
    code = link(rows, members)
    assert code[(1, 1)] == "P" and code[(1, 2)] == "D"       # 한자로
    assert code[(2, 1)] == "P" and code[(2, 2)] == "D"       # 중복을 비운 뒤 금액으로
    assert code[(3, 2)] == "D"                               # 지역구로
    assert code[(3, 1)] == "P"                               # '비례대표' 는 못 맞추지만 금액으로

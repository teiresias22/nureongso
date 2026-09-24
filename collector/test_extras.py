"""겸직·출결: 이름으로 사람 잇기와 출결표 읽기. 네트워크 없이 돈다 (값은 실측 모양 그대로)."""
from ingest import match_person, parse_attendance, sidejob_kind, ymd

# (code, name, name_hanja, district, elect_type, party)
PEOPLE = [
    ("P1", "박지원", "朴智元", "해남군완도군진도군", "지역구", "더불어민주당"),
    ("P2", "박지원", "朴芝源", "전북 군산시김제시부안군을", "지역구", "더불어민주당"),
    ("J1", "박정", "朴釘", "경기 파주시을", "지역구", "더불어민주당"),
    ("L1", "이달곤", "李達坤", "경남 창원시진해구", "지역구", "국민의힘"),
    ("S1", "이수진", "李壽珍", "경기 성남시중원구", "비례대표", "더불어민주당"),
    ("S2", "이수진", "李秀眞", "서울 동작구을", "지역구", "더불어민주당"),
]


def test_match_person() -> None:
    assert match_person(PEOPLE, "박 정") == "J1"            # 띄어쓰기
    assert match_person(PEOPLE, "李達坤") == "L1"           # 한자만
    assert match_person(PEOPLE, "이수진(李秀眞)") == "S2"    # 한자 병기
    assert match_person(PEOPLE, "이수진(비)") == "S1"        # 비례 표시
    assert match_person(PEOPLE, "이수진") is None            # 가를 단서가 없으면 비운다
    # 입력 쪽 한자가 호환 코드(李=U+F9E1)여도 같은 글자로 본다
    assert match_person(PEOPLE, "\uf9e1達坤") == "L1"
    # 출결표: 한자 쪽이 먼저 붙으면 같은 이름 한글 쪽이 갈린다
    assert match_person(PEOPLE, "朴芝源", "더불어민주당") == "P2"
    assert match_person(PEOPLE, "박지원", "더불어민주당") is None
    assert match_person(PEOPLE, "박지원", "더불어민주당", {"P2"}) == "P1"


def test_ymd_and_kind() -> None:
    assert ymd("2021.2.22.") == "2021-02-22"
    assert ymd("2024-09-20") == "2024-09-20"
    assert ymd("(2026년08월26일)") == "2026-08-26"
    assert ymd(None) is None
    assert sidejob_kind("사직 권고") == "사직권고"
    assert sidejob_kind("겸직 불가(현재 진행 중인 강의에 대해서는 가능)") == "불가"
    assert sidejob_kind("국회법 제29조제1항 각 호의 직에 해당하지 않음") == "불가"
    assert sidejob_kind("국회법 제29조제1항 각 호의 직에 해당") == "허용"
    assert sidejob_kind("국회의장의 지명") == "허용"


SHEET = [
    (None,) * 16,
    ("구분", None, "438회(임시)", None, None, None, None, None, None, None, "총 계", None, None, None, None, None),
    ("의원명", "소속정당", "1차(본회의)", "2차(본회의)", "회의일수", "출석", "결석", "청가", "출장", "결석신고서",
     "회의일수", "출석", "결석", "청가", "출장", "결석신고서"),
    (None, None, "(2026년08월20일)", "(2026년08월26일)") + (None,) * 12,
    ("강득구", "더불어민주당", "출석", "출석", "2", "2", "0", "0", "0", "0", "119", "117", "0", "0", "1", "1"),
    ("강선우", "무소속", "청가", "청가", "2", "0", "0", "2", "0", "0", "119", "82", "0", "36", "1", "0"),
    (None,) * 16,
]


def test_parse_attendance() -> None:
    rows, as_of = parse_attendance(SHEET)
    assert as_of == "2026-08-26"
    assert rows[0] == ("강득구", "더불어민주당", 119, 117, 0, 0, 1, 1)
    assert rows[1][5] == 36                                  # 청가
    # 회의일수 = 출석+결석+청가+출장+결석신고서 (결석신고서를 빼면 강득구가 안 맞는다)
    assert all(r[2] == sum(r[3:8]) for r in rows)

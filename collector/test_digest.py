"""digest.py 의 주 경계·지역 풀이·문구·보내기. 네트워크·DB 없이 돈다."""
import json
from datetime import datetime, timezone

import httpx

import digest
from digest import KST

# AREA_SQL 한 줄: code, office, sd_name, wiw_name, district, name (member_area + member.district 실측 모양)
ROWS = [
    ("M1", "국회의원", "전북특별자치도", "김제시", "전북 군산시김제시부안군을", "가의원"),
    ("M2", "국회의원", "대구광역시", "달서구", "대구 달서구갑", "나의원"),
    ("M3", "국회의원", "대구광역시", "서구", "대구 서구", "다의원"),
    ("H1", "구시군의장", "대구광역시", "서구", "서구", "라구청장"),
    ("H2", "구시군의장", "대구광역시", "달서구", "달서구", "마구청장"),
    ("G1", "시도지사", "대구광역시", None, "대구광역시", "바시장"),
    ("E1", "교육감", "대구광역시", None, "대구광역시", "사교육감"),
    ("P1", "국회의원", "전국", None, "비례대표", "아의원"),
    ("G2", "시도지사", "전남광주통합특별시", None, "전남광주통합특별시", "자지사"),
    ("M4", "국회의원", "광주광역시", "북구", "광주 북구갑", "차의원"),
    ("H3", "구시군의장", "광주광역시", "북구", "북구", "카구청장"),
]


def codes(sd, wiw):
    return [c for c, _, _ in digest.resolve(ROWS, sd, wiw)]


def test_week():
    # 월요일 아침(KST)에 도는 실행은 그 월요일 주이고, 담는 기간은 지난주 월 00:00 ~ 이번 주 월 00:00.
    mon = datetime(2026, 10, 12, 9, 10, tzinfo=KST)
    assert digest.week_of(mon).isoformat() == "2026-10-12"
    start, end = digest.window(digest.week_of(mon))
    assert (start.isoformat(), end.isoformat()) == ("2026-10-05T00:00:00+09:00", "2026-10-12T00:00:00+09:00")
    # 일요일 밤은 아직 지난주다.
    assert digest.week_of(datetime(2026, 10, 11, 23, 59, tzinfo=KST)).isoformat() == "2026-10-05"
    # 러너는 UTC 다. UTC 일요일 15:30 은 KST 월요일 00:30 — 새 주다.
    assert digest.week_of(datetime(2026, 10, 11, 15, 30, tzinfo=timezone.utc)).isoformat() == "2026-10-12"


def test_resolve():
    # '서구' 는 달서구에 붙지 않는다. 구청장은 시군구가 같아야, 시도지사·교육감은 시도 전체.
    assert codes("대구광역시", "서구") == ["M3", "H1", "G1", "E1"]
    # 한 지역구가 여러 시를 묶어도(군산시김제시부안군을) 군산시 주민이 자기 의원을 찾는다.
    assert codes("전북특별자치도", "군산시") == ["M1"]
    # 광주는 시도지사만 통합 이름으로 넘어왔다. 광주 북구 주민에게 통합 시도지사가 나와야 한다.
    assert codes("전남광주통합특별시", "북구") == ["M4", "H3", "G2"]
    # 시군구를 안 고르면 시도 전체. 비례대표('전국')는 어디에도 없다.
    assert codes("대구광역시", "") == ["M2", "M3", "H1", "H2", "G1", "E1"]
    assert codes("전국", "") == []


START, END = digest.window(digest.week_of(datetime(2026, 10, 12, 9, tzinfo=KST)))
PEOPLE = [("M3", "다의원", "국회의원"), ("H1", "라구청장", "구시군의장"), ("G1", "바시장", "시도지사")]
CHANGES = [
    ("M3", "bill", {"bill_id": "PRC_A1B2", "name": "도로교통법 일부개정법률안", "proposed_at": "2026-10-07"}),
    ("M3", "vote", {"result": "찬성", "n": 10}),
    ("M3", "vote", {"result": "불참", "n": 2}),
    ("M3", "attendance", {"age": 22, "session_no": 430, "as_of": "2026-10-08", "present": 120, "days": 125}),
    ("H1", "pledge", {"pledge_id": 7, "title": "서구 공영주차장 확충", "order_no": 1, "status": "진행",
                      "prev": "판단불가", "decided_by": "auto"}),
]
# 평가로 읽히는 말. 기록만 옮기므로 문구 틀에서 하나도 나오면 안 된다.
JUDGY = ["우수", "저조", "성실", "칭찬", "비판", "최고", "최악", "잘했", "못했", "!"]


def test_render():
    subject, text = digest.render("대구광역시 서구", PEOPLE, CHANGES, START, END, "TOKEN")
    assert subject == "[누렁소검은소] 대구광역시 서구 주간 기록 10.05~10.11"
    assert "2026-10-05 ~ 2026-10-11 에 새로 수집된 공개 기록" in text
    assert "■ 다의원 (국회의원)  https://nureongso.joon.is-a.dev/m/M3" in text
    assert "- 대표발의 도로교통법 일부개정법률안 (2026-10-07)\n  https://nureongso.joon.is-a.dev/bill/PRC_A1B2" in text
    assert "- 본회의 표결 12건: 찬성 10 · 반대 0 · 기권 0 · 불참 2" in text
    assert "- 본회의 출결 제22대 제430회까지 누적: 출석 120 / 회의일수 125" in text
    # 판정 이력에서 상태가 바뀐 줄이다(이전 → 지금). 근거·이력은 공약 상세에서 본다.
    assert ("- 공약 판정 「서구 공영주차장 확충」 판단불가 → 진행 (자동 판정)\n"
            "  https://nureongso.joon.is-a.dev/pledge/7") in text
    # 국회의원이 위, 기록이 없는 사람(바시장)은 싣지 않는다.
    assert text.index("다의원") < text.index("라구청장") and "바시장" not in text
    assert "https://nureongso.joon.is-a.dev/rules" in text
    assert "https://nureongso.joon.is-a.dev/subscription?do=stop&t=TOKEN" in text
    for w in JUDGY:
        assert w not in subject + text, w


def test_render_caps_and_empty():
    # 재적재로 한 주에 수백 건이 '새로' 잡혀도 한 사람·한 종류는 10줄까지만.
    many = [("M3", "bill", {"bill_id": f"B{i:02}", "name": f"법안{i:02}", "proposed_at": None}) for i in range(12)]
    _, text = digest.render("대구광역시 서구", PEOPLE, many, START, END, "T")
    assert text.count("- 대표발의 법안") == 10 and "- 대표발의 외 2건" in text
    assert "(None)" not in text  # 발의일이 비면 괄호를 달지 않는다
    # 기록 없는 주는 보내지 않는다.
    assert digest.render("대구광역시 서구", PEOPLE, [], START, END, "T") is None


def test_send():
    got = []

    def ok(req):
        got.append(req)
        return httpx.Response(200, json={"id": "x"})

    with httpx.Client(transport=httpx.MockTransport(ok)) as c:
        digest.send(c, "a@example.com", "제목", "본문", "https://s/api/subscription?do=stop&t=T", "digest-2026-10-12-1")
    body = json.loads(got[0].content)
    assert body["to"] == ["a@example.com"] and body["subject"] == "제목" and body["text"] == "본문"
    # 메일 앱의 '구독 해지' 단추가 한 번에 해지하게(RFC 8058)
    assert body["headers"] == {"List-Unsubscribe": "<https://s/api/subscription?do=stop&t=T>",
                               "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    # 타임아웃 뒤 다시 보내도 같은 메일이 두 번 가지 않게(24시간)
    assert got[0].headers["Idempotency-Key"] == "digest-2026-10-12-1"

    full = httpx.MockTransport(lambda req: httpx.Response(429, json={"name": "daily_quota_exceeded"}))
    with httpx.Client(transport=full) as c:
        try:
            digest.send(c, "a@example.com", "s", "t", "u", "k")
        except digest.Quota:
            pass
        else:
            raise AssertionError("하루 한도(429)에서 멈춰야 한다")

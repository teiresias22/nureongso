"""DB 없이 도는 최소 검증. `python test_ingest.py` 로 실행."""
import ingest


def test_parse_dt():
    assert ingest.parse_dt("20260917 161700") == "2026-09-17 16:17:00"
    assert ingest.parse_dt("20260917") == "2026-09-17 00:00:00"
    assert ingest.parse_dt("") is None and ingest.parse_dt(None) is None


def test_fetch_and_shape():
    """실제 API 한 페이지를 받아 필드명이 그대로인지 확인한다."""
    ingest.PAGE = 5
    members = ingest.fetch("incumbent", max_rows=5)
    assert members and {"MONA_CD", "HG_NM", "POLY_NM"} <= members[0].keys()

    bills = ingest.fetch("bills", max_rows=5, AGE=22)
    b = bills[0]
    assert {"BILL_ID", "RST_MONA_CD", "PUBL_MONA_CD", "PROPOSE_DT"} <= b.keys()
    # 공동발의자 코드가 콤마 구분 문자열인지
    if b.get("PUBL_MONA_CD"):
        assert all(c.strip() for c in b["PUBL_MONA_CD"].split(","))

    plenary = ingest.fetch("plenary", max_rows=5, AGE=22)
    assert {"BILL_ID", "PROC_RESULT_CD", "YES_TCNT"} <= plenary[0].keys()

    votes = ingest.fetch("votes", max_rows=5, AGE=22, BILL_ID=plenary[0]["BILL_ID"])
    assert {"MONA_CD", "RESULT_VOTE_MOD", "VOTE_DATE"} <= votes[0].keys()


if __name__ == "__main__":
    test_parse_dt()
    test_fetch_and_shape()
    print("ok")

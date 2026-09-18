"""DB 없이 도는 최소 검증. `python test_ingest.py` 로 실행. ASSEMBLY_API_KEY 필요."""
import os

import ingest


def test_parse_dt():
    assert ingest.parse_dt("20260917 161700") == "2026-09-17 16:17:00"
    assert ingest.parse_dt("20260917") == "2026-09-17 00:00:00"
    assert ingest.parse_dt("") is None and ingest.parse_dt(None) is None


def test_key_required():
    """키 없이 호출하면 서버가 첫 5행만 반복하므로 아예 막아야 한다."""
    saved, ingest.KEY = ingest.KEY, None
    try:
        ingest.fetch("incumbent")
        raise AssertionError("키 없이 호출이 통과되면 안 된다")
    except RuntimeError as e:
        assert "ASSEMBLY_API_KEY" in str(e)
    finally:
        ingest.KEY = saved


def test_pagination_advances():
    """페이지가 실제로 넘어가는지. 키가 무효하면 여기서 걸린다."""
    ingest.PAGE = 100
    rows = ingest.fetch("incumbent")
    assert len(rows) >= 295, f"현역 의원이 {len(rows)}명뿐 — 페이지네이션 확인"
    assert len({r["MONA_CD"] for r in rows}) == len(rows), "중복 행이 있다"


def test_field_names():
    """API 응답 필드명이 코드가 기대하는 그대로인지."""
    ingest.PAGE = 100
    b = ingest.fetch("bills", max_rows=5, AGE=22)[0]
    assert {"BILL_ID", "RST_MONA_CD", "PUBL_MONA_CD", "PROPOSE_DT"} <= b.keys()

    p = ingest.fetch("plenary", max_rows=5, AGE=22)[0]
    assert {"BILL_ID", "PROC_RESULT_CD", "YES_TCNT"} <= p.keys()

    v = ingest.fetch("votes", max_rows=5, AGE=22, BILL_ID=p["BILL_ID"])[0]
    assert {"MONA_CD", "RESULT_VOTE_MOD", "VOTE_DATE"} <= v.keys()

    m = ingest.fetch("allmember", max_rows=5)[0]
    assert {"NAAS_CD", "NAAS_NM", "GTELT_ERACO", "NAAS_PIC"} <= m.keys()


if __name__ == "__main__":
    test_parse_dt()
    test_key_required()
    if not os.getenv("ASSEMBLY_API_KEY"):
        raise SystemExit("ASSEMBLY_API_KEY 를 설정하면 나머지 검증도 실행됩니다.")
    test_pagination_advances()
    test_field_names()
    print("ok")

"""선관위 수집기 최소 검증. `python test_nec.py` 로 실행.

DATA_GO_KR_KEY 가 없어도 (a) 키 요구, (b) 엔드포인트 경로 유효성, (c) 코드표 정합성은 확인한다.
키가 있으면 실제 응답 형태까지 검증한다.
"""
import os

import httpx

import nec


def test_key_required():
    saved, nec.KEY = nec.KEY, None
    try:
        nec.fetch("sg_code")
        raise AssertionError("키 없이 호출이 통과되면 안 된다")
    except RuntimeError as e:
        assert "DATA_GO_KR_KEY" in str(e)
    finally:
        nec.KEY = saved


def test_endpoint_paths_exist():
    """공공데이터포털은 경로가 틀리면 NO_OPENAPI_SERVICE_ERROR 를 준다.
    가짜 키로 호출해 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 나오면 경로는 맞는 것."""
    for op, url in nec.OPS.items():
        body = httpx.get(url, params={"serviceKey": "TEST", "resultType": "json"},
                         timeout=30).text
        assert "NO_OPENAPI_SERVICE_ERROR" not in body, f"{op}: 경로가 없다 — {url}"
        assert "SERVICE_KEY" in body or "RESULT" in body, f"{op}: 예상 밖 응답 — {body[:120]}"


def test_code_table():
    assert nec.OFFICE_CODE["시도지사"] == "3"
    assert nec.OFFICE_CODE["교육감"] == "11"
    assert nec.OFFICE_CODE["국회의원"] == "2"
    # 공약 API 는 선거공약서 제출 대상만 제공한다
    assert nec.PLEDGE_TYPES == {"1", "3", "4", "11"}
    assert all(o in nec.OFFICE_CODE for o in nec.OFFICES)


def test_live():
    """키가 있을 때만. 선거 목록과 최신 시도지사 당선인을 실제로 받아본다."""
    els = nec.fetch("sg_code")
    assert len(els) >= 40, f"역대 선거가 {len(els)}건뿐"
    assert {"sgId", "sgTypecode", "sgName"} <= els[0].keys()

    gov = [e for e in els if e["sgTypecode"] == "3"]
    assert gov, "시도지사 선거가 목록에 없다"
    latest = max(gov, key=lambda e: e["sgId"])["sgId"]

    ws = nec.fetch("winner", sgId=latest, sgTypecode="3")
    assert len(ws) >= 15, f"시도지사 당선인이 {len(ws)}명 (17 예상)"
    assert {"huboid", "name", "jdName", "sdName", "dugyul"} <= ws[0].keys()

    p = nec.fetch("pledge", sgId=latest, sgTypecode="3", cnddtId=ws[0]["huboid"])
    if p:
        assert "prmsTitle1" in p[0], f"공약 제목 필드 없음: {list(p[0])[:8]}"
        # 본문은 prmsCont 가 아니라 prmmCont. 오타가 고쳐지면 여기서 걸린다.
        assert "prmmCont1" in p[0] or "prmsCont1" in p[0], "공약 본문 필드를 못 찾음"


if __name__ == "__main__":
    test_key_required()
    test_code_table()
    test_endpoint_paths_exist()
    if not os.getenv("DATA_GO_KR_KEY"):
        raise SystemExit("경로·코드표 검증 통과. DATA_GO_KR_KEY 를 넣으면 실제 응답까지 검증합니다.")
    test_live()
    print("ok")

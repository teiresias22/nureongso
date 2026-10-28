"""sample_review.plan_marks: 라벨 → review 표시. DB 없이 돈다."""
import sample_review


def row(**kw):
    base = dict(pledge_id="7", ev="", label="", missed="", scope="", enacted="", reviewer="", reviewed_at="2026-10-19")
    return base | kw


def test_plan_marks():
    out = sample_review.plan_marks([
        row(ev="bill:A", label="ok", scope="전부", enacted="예", reviewer="홍길동"),
        row(ev="bill:B", label="wrong", scope="전부", enacted="예", reviewer="홍길동"),
        row(pledge_id="8", ev="bid:C", label="ok", scope="일부", reviewer="Claude", codex_label="partial"),
        row(pledge_id="9", missed="bill:D bill:E", reviewer="Claude", codex_label="ok"),
        row(pledge_id="10", ev="bill:F", label="ok", reviewed_at=""),   # 검수 전 줄은 건너뛴다
    ])
    human, llm = out[False], out[True]
    assert human == ({(7, "bill", "A"): "ok:2026-10-19", (7, "bill", "B"): "reject:2026-10-19"}, [])
    assert llm[0] == {(8, "bid", "C"): "partial:2026-10-19:llm"}
    assert llm[1] == [(9, "bill", "D", "llm-reviewer:2026-10-19", "ok:2026-10-19:llm"),
                      (9, "bill", "E", "llm-reviewer:2026-10-19", "ok:2026-10-19:llm")]


def test_llm_rows_need_codex_agreement():
    rows = [
        row(pledge_id="1", ev="bill:A", label="wrong", reviewer="Claude", codex_label="wrong"),   # 합의
        row(pledge_id="2", ev="bill:B", label="wrong", reviewer="Claude", codex_label="ok"),      # 맞음↔관련 없음
        row(pledge_id="3", ev="bill:C", label="ok", reviewer="Claude"),                          # Codex 안 봄
        row(pledge_id="4", ev="bill:D", label="ok", scope="일부", reviewer="Claude", codex_label="ok"),  # 일부만 vs 맞음
        row(pledge_id="6", ev="bill:G", label="wrong", reviewer="Claude", codex_label="partial"),  # 관련 없음 vs 일부만
        row(pledge_id="7", missed="bill:H", reviewer="Claude", codex_label="partial"),            # 찾은 기록, 일부만
        row(pledge_id="5", ev="bill:E", label="wrong", reviewer="홍길동"),                         # 사람은 그대로
    ]
    out = sample_review.plan_marks(rows)
    # 한쪽이라도 일부만이면 일부만으로 반영한다(2026-10-23 결정).
    assert out[True][0] == {(1, "bill", "A"): "reject:2026-10-19:llm", (4, "bill", "D"): "partial:2026-10-19:llm",
                            (6, "bill", "G"): "partial:2026-10-19:llm"}
    assert out[True][1] == [(7, "bill", "H", "llm-reviewer:2026-10-19", "partial:2026-10-19:llm")]
    assert out[False][0] == {(5, "bill", "E"): "reject:2026-10-19"}
    assert [r["pledge_id"] for r in sample_review.held_rows(rows)] == ["2", "3"]


def test_parse_codex():
    assert sample_review.parse_codex('{"label": "ok", "why": "같은 법"}') == ("ok", "같은 법")
    assert sample_review.parse_codex('```json\n{"label":"partial","why":"일부"}\n```') == ("partial", "일부")
    assert sample_review.parse_codex('잘 모르겠다') is None
    assert sample_review.parse_codex('{"label": "maybe", "why": ""}') is None

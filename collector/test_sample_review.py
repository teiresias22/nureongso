"""sample_review.plan_marks: 라벨 → review 표시. DB 없이 돈다."""
import sample_review


def row(**kw):
    base = dict(pledge_id="7", ev="", label="", missed="", scope="", enacted="", reviewer="", reviewed_at="2026-10-19")
    return base | kw


def test_plan_marks():
    out = sample_review.plan_marks([
        row(ev="bill:A", label="ok", scope="전부", enacted="예", reviewer="홍길동"),
        row(ev="bill:B", label="wrong", scope="전부", enacted="예", reviewer="홍길동"),
        row(pledge_id="8", ev="bid:C", label="ok", scope="일부", reviewer="Claude"),
        row(pledge_id="9", missed="bill:D bill:E", reviewer="Claude"),
        row(pledge_id="10", ev="bill:F", label="ok", reviewed_at=""),   # 검수 전 줄은 건너뛴다
    ])
    human, llm = out[False], out[True]
    assert human == ({(7, "bill", "A"): "ok:2026-10-19", (7, "bill", "B"): "reject:2026-10-19"}, [])
    assert llm[0] == {(8, "bid", "C"): "partial:2026-10-19:llm"}
    assert llm[1] == [(9, "bill", "D", "llm-reviewer:2026-10-19", "ok:2026-10-19:llm"),
                      (9, "bill", "E", "llm-reviewer:2026-10-19", "ok:2026-10-19:llm")]

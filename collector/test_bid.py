"""bid.run_fetch 가 달마다 끝 쪽까지 받는지. 가짜 API·가짜 DB 라 네트워크·키가 필요 없다."""
import bid


class _Conn:
    def cursor(self): return self
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def commit(self): pass


def test_every_month_reads_all_pages():
    calls = []

    def fake_fetch(client, bgn, end, page):
        calls.append((bgn[:6], page))
        n = bid.PAGE if page <= 2 else (5 if page == 3 else 0)
        return [{"bdgtAmt": "1", "bidNtceNo": f"{bgn}-{page}-{i}"} for i in range(n)], bid.PAGE * 2 + 5

    saved = {k: getattr(bid, k) for k in ("fetch_page", "tracked_orgs", "upsert", "log_run", "refresh_first")}
    bid.fetch_page, bid.tracked_orgs = fake_fetch, lambda cur: {}
    bid.upsert = bid.log_run = lambda *a, **k: None
    bid.refresh_first = lambda conn: None
    try:
        bid.run_fetch(_Conn(), "20260701", "20260930", 0)
    finally:
        for k, v in saved.items():
            setattr(bid, k, v)
    last = {}
    for m, p in calls:
        last[m] = max(last.get(m, 0), p)
    # 둘째 달부터 첫 쪽에서 끊기던 버그(seen 을 달 밖에서 셌다)
    assert last == {"202607": 3, "202608": 3, "202609": 3}, last

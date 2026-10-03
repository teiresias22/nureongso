#!/usr/bin/env python3
"""llm.py 의 키 순환·재시도 자체 점검. 네트워크를 타지 않는다.

    python test_llm.py
"""
import os

os.environ.setdefault("GEMINI_API_KEY", "k1, k2 k3")

import llm  # noqa: E402


def reset(raw: str) -> None:
    os.environ["GEMINI_API_KEY"] = raw
    llm._keys = None
    llm._key_i = 0
    llm._gemini_model = "dummy"


def test_parsing():
    reset("k1, k2 k3")
    assert llm.gemini_keys() == ["k1", "k2", "k3"]
    # 하나만 넣던 기존 설정이 그대로 동작해야 한다.
    reset("only")
    assert llm.gemini_keys() == ["only"]
    assert llm.gemini_key() == "only"


def test_rotation_stops_at_the_end():
    reset("a,b")
    assert llm.gemini_key() == "a"
    assert llm.gemini_rotate() is True
    assert llm.gemini_key() == "b"
    # 키마다 쓸 수 있는 모델이 다를 수 있어 다시 고르게 비워야 한다.
    assert llm._gemini_model is None
    # 마지막 키까지 쓰면 더는 갈아탈 곳이 없다. 여기서 True 를 돌려주면
    # complete() 가 같은 키로 영원히 맴돈다.
    assert llm.gemini_rotate() is False
    assert llm.gemini_key() == "b"


def test_complete_switches_keys_then_gives_up():
    reset("a,b")
    llm.PROVIDER = "gemini"
    seen: list[str] = []

    def always_exhausted(prompt, schema, pdf=None):
        seen.append(llm.gemini_key())
        raise llm.QuotaExhausted("일일 한도")

    llm.CALLS["gemini"] = always_exhausted
    try:
        llm.complete("x")
        assert False, "키가 다 떨어지면 QuotaExhausted 가 올라와야 한다"
    except llm.QuotaExhausted:
        pass
    # 키 하나당 정확히 한 번. 재시도 횟수를 소모하지 않아야 한다.
    assert seen == ["a", "b"], seen

    # 두 번째 키가 살아 있으면 그 키로 성공해야 한다.
    reset("a,b")
    calls: list[str] = []

    def dies_once(prompt, schema, pdf=None):
        calls.append(llm.gemini_key())
        if llm.gemini_key() == "a":
            raise llm.QuotaExhausted("일일 한도")
        return "ok"

    llm.CALLS["gemini"] = dies_once
    assert llm.complete("x") == "ok"
    assert calls == ["a", "b"], calls


def test_overload_is_retried_then_raised():
    # 503 은 잠깐 뒤 풀린다. 한 번 실패로 넘기지 말고 기다렸다 다시 부른다.
    reset("a")
    llm.PROVIDER = "gemini"
    sleep, llm.time.sleep = llm.time.sleep, lambda s: None
    try:
        n = [0]

        def busy_twice(prompt, schema, pdf=None):
            n[0] += 1
            if n[0] <= 2:
                raise llm.Overloaded("503: high demand")
            return "ok"

        llm.CALLS["gemini"] = busy_twice
        assert llm.complete("x") == "ok" and n[0] == 3, n

        # 계속 과부하면 retries 번 시도하고 올려보낸다(호출한 쪽이 '실패' 로 넘긴다).
        n[0] = -100
        try:
            llm.complete("x", retries=3)
            assert False, "끝까지 과부하면 Overloaded 가 올라와야 한다"
        except llm.Overloaded:
            pass
        assert n[0] == -97, n
    finally:
        llm.time.sleep = sleep


if __name__ == "__main__":
    test_parsing()
    test_rotation_stops_at_the_end()
    test_complete_switches_keys_then_gives_up()
    test_overload_is_retried_then_raised()
    print("ok")

#!/usr/bin/env python3
"""LLM 호출을 한 군데로 모은 얇은 계층.

업체를 갈아끼울 수 있게 해 둔다. 무료 한도에 걸리거나 모델이 없어지면 환경변수만 바꾼다.

    LLM_PROVIDER=gemini   (기본)  GEMINI_API_KEY   — 무료 등급 있음, 카드 불필요
    LLM_PROVIDER=ollama           OLLAMA_MODEL     — 로컬, 한도·비용 없음, 느림
    LLM_PROVIDER=anthropic        ANTHROPIC_API_KEY — 유료 전용

모델 이름은 자주 바뀌므로 코드에 박지 않는다. 지정이 없으면 계정에서 쓸 수 있는
모델을 조회해 고른다.

    python llm.py models          # 이 키로 쓸 수 있는 모델 목록
    python llm.py ping            # 실제로 한 번 호출해 본다
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

import httpx

PROVIDER = os.getenv("LLM_PROVIDER", "gemini").lower()


class LLMError(RuntimeError):
    pass


class RateLimited(LLMError):
    """무료 한도 초과. 호출부가 기다렸다 다시 시도할 수 있게 따로 둔다."""


# --------------------------------------------------------------------------- Gemini

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
# 싸고 빠른 순으로 선호. 이름이 바뀌어도 list_models 결과와 대조해서 고른다.
GEMINI_PREFER = ("flash-lite", "flash", "pro")


def gemini_key() -> str:
    k = os.getenv("GEMINI_API_KEY")
    if not k:
        raise LLMError("GEMINI_API_KEY 가 없습니다. https://aistudio.google.com/apikey 에서"
                       " 발급하세요 (카드 불필요).")
    return k


def gemini_models() -> list[str]:
    r = httpx.get(f"{GEMINI_BASE}/models", params={"key": gemini_key()}, timeout=60)
    if r.status_code == 400:
        raise LLMError(f"키가 거부됐습니다: {r.text[:200]}")
    r.raise_for_status()
    out = []
    for m in r.json().get("models", []):
        if "generateContent" in (m.get("supportedGenerationMethods") or []):
            out.append(m["name"].removeprefix("models/"))
    return out


def gemini_pick(models: list[str]) -> str:
    """미리보기·실험판은 피하고, 싼 것부터 고른다."""
    stable = [m for m in models if not re.search(r"preview|exp|thinking", m)]
    for kind in GEMINI_PREFER:
        hit = sorted((m for m in (stable or models) if kind in m), reverse=True)
        if hit:
            return hit[0]
    if not models:
        raise LLMError("이 키로 쓸 수 있는 모델이 없습니다.")
    return models[0]


_gemini_model: str | None = None


def gemini_model() -> str:
    global _gemini_model
    if _gemini_model is None:
        _gemini_model = os.getenv("GEMINI_MODEL") or gemini_pick(gemini_models())
        print(f"[llm] gemini 모델: {_gemini_model}", file=sys.stderr)
    return _gemini_model


def gemini_call(prompt: str, schema: dict | None) -> str:
    body: dict = {"contents": [{"parts": [{"text": prompt}]}]}
    cfg: dict = {"temperature": 0}
    if schema:
        cfg["responseMimeType"] = "application/json"
        cfg["responseSchema"] = schema
    body["generationConfig"] = cfg

    r = httpx.post(
        f"{GEMINI_BASE}/models/{gemini_model()}:generateContent",
        params={"key": gemini_key()}, json=body, timeout=180,
    )
    if r.status_code == 429:
        raise RateLimited(r.text[:300])
    if r.status_code >= 400:
        raise LLMError(f"{r.status_code}: {r.text[:300]}")
    data = r.json()
    cands = data.get("candidates") or []
    if not cands:
        raise LLMError(f"응답에 후보가 없습니다: {json.dumps(data)[:300]}")
    parts = cands[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts).strip()
    if not text:
        raise LLMError(f"빈 응답 (finishReason={cands[0].get('finishReason')})")
    return text


# --------------------------------------------------------------------------- Ollama

def ollama_call(prompt: str, schema: dict | None) -> str:
    model = os.getenv("OLLAMA_MODEL", "qwen3:8b")
    body = {"model": model, "prompt": prompt, "stream": False,
            "options": {"temperature": 0}}
    if schema:
        body["format"] = schema
    try:
        r = httpx.post(f"{os.getenv('OLLAMA_HOST', 'http://localhost:11434')}/api/generate",
                       json=body, timeout=600)
    except httpx.ConnectError as e:
        raise LLMError("ollama 에 연결할 수 없습니다. `ollama serve` 가 떠 있는지 확인하세요.") from e
    r.raise_for_status()
    return (r.json().get("response") or "").strip()


# --------------------------------------------------------------------------- Anthropic

def anthropic_call(prompt: str, schema: dict | None) -> str:
    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise LLMError("ANTHROPIC_API_KEY 가 없습니다. (무료 등급 없음 — 사용량만큼 과금됩니다)")
    model = os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
    r = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        json={"model": model, "max_tokens": 8000, "temperature": 0,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=180,
    )
    if r.status_code == 429:
        raise RateLimited(r.text[:300])
    if r.status_code >= 400:
        raise LLMError(f"{r.status_code}: {r.text[:300]}")
    return "".join(b.get("text", "") for b in r.json().get("content", [])).strip()


CALLS = {"gemini": gemini_call, "ollama": ollama_call, "anthropic": anthropic_call}


def complete(prompt: str, schema: dict | None = None, retries: int = 4) -> str:
    """한 번 호출. 429 는 기다렸다 다시 시도한다(무료 등급은 분당 제한이 빡빡하다)."""
    call = CALLS.get(PROVIDER)
    if not call:
        raise LLMError(f"모르는 LLM_PROVIDER: {PROVIDER} (가능: {', '.join(CALLS)})")
    for attempt in range(retries):
        try:
            return call(prompt, schema)
        except RateLimited:
            if attempt == retries - 1:
                raise
            wait = 20 * (attempt + 1)
            print(f"[llm] 한도 초과, {wait}초 대기", file=sys.stderr)
            time.sleep(wait)
        except httpx.TimeoutException:
            if attempt == retries - 1:
                raise
            time.sleep(5)
    raise LLMError("재시도 초과")


def complete_json(prompt: str, schema: dict | None = None, **kw):
    """JSON 을 받아 파싱한다. 모델이 ```json 울타리를 붙이는 경우까지 처리."""
    text = complete(prompt, schema, **kw)
    m = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"JSON 파싱 실패: {e}\n응답 앞부분: {text[:300]}") from e


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "ping"
    if cmd == "models":
        if PROVIDER != "gemini":
            sys.exit(f"models 는 gemini 전용입니다 (지금 LLM_PROVIDER={PROVIDER}).")
        ms = gemini_models()
        print(f"쓸 수 있는 모델 {len(ms)}개:")
        for m in ms:
            print("  ", m)
        print("\n자동 선택:", gemini_pick(ms))
    else:
        out = complete_json(
            '다음을 JSON 으로만 답하세요: {"ok": true, "lang": "<이 문장의 언어>"}',
            {"type": "object", "properties": {"ok": {"type": "boolean"},
                                              "lang": {"type": "string"}},
             "required": ["ok", "lang"]},
        )
        print(f"[{PROVIDER}] 응답:", out)

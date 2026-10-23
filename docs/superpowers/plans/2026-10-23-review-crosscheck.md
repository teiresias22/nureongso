# LLM 교차 확인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정답 표본의 Claude 라벨을 Codex(ChatGPT)로 다시 보고, 합의한 줄만 'LLM 확인' 으로 반영한다.
**Architecture:** `collector/sample_review.py` 에 `crosscheck` 단계와 `apply` 갈림길(합의·미착수 보류·사람 확인 목록)을 더한다.
**Tech Stack:** Python, Codex CLI(`codex exec --ephemeral`, ChatGPT 로그인), psycopg.
**Spec:** `docs/superpowers/specs/2026-10-23-review-crosscheck-design.md`

## Global Constraints
- LLM 합의는 사람 확인이 아니다. 미착수로 가는 LLM 표시는 합의해도 사람에게 넘긴다.
- Codex 대화는 디스크에 남기지 않는다(`--ephemeral`).

### Task 1: 순수 함수 + 테스트 — `claude_verdict`·`agreed`·`held_rows`·`plan_marks(rows, held)`·`parse_codex`, `test_sample_review.py` [x]
### Task 2: `crosscheck` — `run_codex`·`run_crosscheck`·`write_gold`(줄마다 저장), CSV 칸 `codex_label`·`codex_why` [x]
### Task 3: `apply` — savepoint 반복으로 미착수 공약 보류, `write_human_check` 로 사람 확인 목록 [x]
### Task 4: `/rules` 5번 문구 [x]
### Task 5: 실제 실행 — T1.8 표본 111줄 crosscheck → apply 미리보기로 전이 확인 [ ]

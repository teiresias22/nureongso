# LLM 교차 확인으로 사람 확인 대상 줄이기

정답 표본 검수(판정 계획 T1.8)는 Claude 가 라벨한 줄을 근거 `review` 로 반영한다. 2026-10-23 미리보기에서
LLM 라벨만으로 '완료 → 미착수' 7건이 나왔다. 미착수는 유일한 부정 판정이라 사람이 확인했다.
매번 전부를 사람이 볼 수는 없으니, 두 번째 모델(ChatGPT, Codex)로 같은 줄을 다시 보게 해 사람이 볼 몫을 줄인다.

## 원칙

- 두 AI 의 합의는 사람 확인이 아니다. 화면·`/rules` 는 'LLM 확인' 으로 적고 '사람 확인' 과 섞지 않는다.
- 부정 판정(미착수)으로 가는 반영은 합의해도 사람이 확인한다.
- 판정은 늘 규칙표가 낸다(결정 M). 교차 확인은 `review` 를 다는 조건만 바꾼다.

## 흐름 (`collector/sample_review.py`)

1. `crosscheck [--dir]` — 라벨 CSV 에서 `reviewer=Claude` 이고 `codex_label` 이 빈 줄마다 `codex exec` 를 한 번 부른다.
   - 입력: 공약 제목·본문, 근거 이름·처리결과·날짜, AI 연결 이유. Codex 는 인터넷을 쓰지 않는다.
   - 출력: `{"label": "ok|wrong|partial", "why": "<한 줄>"}`. 파싱 실패·호출 실패는 그 줄을 비워 둔다(다시 돌리면 이어서).
   - 결과는 CSV 새 칸 `codex_label`·`codex_why` 에 쓴다.
2. `apply` 갈림길
   - LLM 줄은 `codex_label == label` 일 때만 `:llm` 으로 반영한다. 다르거나 비었으면 보류.
   - 반영 뒤 판정이 미착수가 되는 공약의 LLM 줄은 합의해도 보류.
   - 보류 줄은 `docs/review/human-check-<날짜>.md`(공약·의안 링크·두 AI 이유)로 낸다.
   - 사람이 답한 줄(`reviewer` 가 사람)은 지금처럼 '사람 확인' 으로 반영한다.
3. `/rules` 5번: "LLM 확인은 Claude·ChatGPT 두 모델이 같은 판단일 때만 붙이고, 미착수로 가는 건 사람이 확인한다."

## 실행 조건

이 Mac 의 Codex CLI(`codex login`, ChatGPT 유료 플랜). 정기 실행(Actions)·OpenAI API 연결은 하지 않는다.

## 테스트

`test_sample_review.py`: 합의·불일치·빈 값 갈림, 미착수 보류, Codex 응답 파싱(울타리·잘못된 JSON). 실제 호출은 7건으로 한 번.

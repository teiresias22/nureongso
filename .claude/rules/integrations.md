---
paths:
  - "collector/ingest.py"
  - "collector/nec.py"
  - "collector/bulletin.py"
  - "collector/ordin.py"
  - "collector/bid.py"
  - "collector/expense.py"
  - "collector/llm.py"
  - "collector/districts.py"
  - "collector/digest.py"
  - "web/src/app/api/subscription/route.ts"
---

# 외부 API — 실측 함정

출처 표는 README '데이터 출처'. 여기는 고칠 때 밟는 것만.

## 열린국회정보 (`ingest.py`)
- 키 없으면 `pIndex`/`pSize` 무시, 첫 5행 반복, 총건수는 정상. 수집기는 키 없으면 시작 안 하고 페이지가 안 넘어가면 멈춘다 — 이 가드를 빼지 않는다.
- 전체 목록(`OPENSRVAPI`)의 `SRV_URL` 은 설명 화면이다. 실제 호출 이름은 `DDC_URL` 명세서 xls 안에만 있다.
- 겸직·출결·국외활동·연구단체는 의원 코드 없이 **이름만** 준다 → `match_person`. 연구단체 명단은 API 가 아니라 `LINK_URL`(국회 홈페이지)을 믿는다.
- `member.name_hanja` 는 호환용 한자(U+F9E1 등). 비교 전에 NFC.
- 본회의 출결은 API 가 없다. 22대 제415회~ xlsx(최신 하나에 누적), 그 전은 회기별 PDF 를 전부 더한다.

## 선관위 data.go.kr (`nec.py`)
- 인증키는 **인코딩 키 그대로**. 다시 인코딩하면 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`(nec.py 가 되돌린다).
- 당선인은 `WinnerInfoInqireService2`(2 필수). 공약 본문은 `prmmCont`(선관위 오타), 제목 `prmsTitle`.
- 정당정책 API 는 무엇을 넣어도 `INFO-03`. 쓰지 않는다.
- 선거별 목록은 그 의석의 **현재 주인**이다. 중도 사퇴자의 과거 공보는 구할 수 없다(수집기 버그 아님).

## 기타
- 법제처(`ordin.py`, `LAW_OC`): 가끔 통째로 막힌다. 재시도로 버티지 말고 다음 주 겹쳐 받기에 맡긴다.
- 나라장터(`bid.py`): 공고 중복 제거는 `bid_notice_first` 머티리얼라이즈드 뷰. `fetch` 끝에 refresh 를 빼지 않는다.
- 업무추진비(`expense.py`): 전국 API 없음, 시도 게시판마다 어댑터. 새 시도는 `ADAPTERS` 에 하나 더하고 칸 이름은 `FIELDS` 가 맞춘다.
- LLM(`llm.py`): `LLM_PROVIDER` = gemini(기본·무료) | anthropic | ollama. 정기 워크플로는 `GEMINI_MODEL` 을 고정한다
  (`evidence.yml` gemini-3.1-flash-lite, `race.yml` gemini-3.5-flash) — 바꾸는 것은 따로 커밋. 한도에 걸리면 `QuotaExhausted` 로 깨끗이 멈추고 다음 실행이 이어받는다 — 재시도 루프를 넣지 않는다.

## 메일 — Resend (`digest.py`, `api/subscription/route.ts`)
- 무료 하루 100통·월 3,000통. 하루 한도는 **UTC 자정**에 풀린다. 확인 메일(web)도 같은 한도를 쓴다.
- 429 는 이름으로 갈린다: `rate_limit_exceeded`(기본 초당 10건), `daily_quota_exceeded`, `monthly_quota_exceeded`.
  digest.py 는 셋 다 `Quota` 로 깨끗이 멈추고 다음 실행이 잇는다 — 재시도 루프를 넣지 않는다(LLM 과 같다).
- `Idempotency-Key` 는 24시간. 주간 메일은 `digest-{week}-{id}` 를 단다.
- 보내는 도메인은 Resend 에서 확인(SPF·DKIM TXT, MX)해야 한다. 확인 전에는 계정 주소로만 간다.

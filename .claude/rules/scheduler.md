---
paths:
  - ".github/workflows/**"
  - "collector/run_pledges.sh"
---

# 정기 수집

| 워크플로 | 언제(KST) | 동시 실행 그룹 | 하는 일 |
|---|---|---|---|
| `ingest.yml` | 매일 04:00 | `ingest` | `ingest.py all` — members→staff→bills→plenary→votes→summaries→sidejobs→attendance→trips→research→studies |
| `nec.yml` | 화 04:30 | `ingest` | `nec.py elections/winners/pledges` → `ingest.py refresh` → `asset.py fetch` → `gwanbo.py fetch` |
| `evidence.yml` | 월 05:00 | `evidence` | `ordin.py`·`bid.py fetch`+`link`·`expense.py` → `judge.py classify→match→match_ordin→match_bid→snapshot→decide→quote→repro` |
| `race.yml` | 매일 18:00 | `race` | `judge.py match_race --since …` — 후보 공약 비교를 gemini-3.5-flash 로 이어서 다시 만든다 |
| `digest.yml` | 매일 09:10 | `digest` | `digest.py` — 구독자에게 지난주(월~일) 새로 수집된 기록 메일. 한 사람에게 한 주 한 통 |

- `ingest`·`nec` 가 한 그룹인 이유: 둘 다 `member` 를 쓴다. 그룹은 실행 하나 + 대기 하나라서 수동 실행을
  연달아 넣으면 앞의 대기 실행이 취소된다. 하나 끝난 뒤 다음을 넣는다. `ingest.yml` 수동 실행은 `step` 에 단계 하나.
- `evidence.yml` 의 judge 순서는 바꾸지 않는다. classify 를 대조 뒤에 돌렸다가 새로 유형이 붙은 공약
  5,262건이 영영 대조되지 않았다. 네 단계 모두 '아직 안 한 것' 만 집어 새 공약이 없으면 LLM 호출 0건.
  대조 셋은 마지막 대조 뒤 새로 들어온 법안·조례·공고가 있는 사람도 다시 보되 그 새 기록만 후보로 넘긴다.
  `snapshot`(근거 버전)은 `decide` 바로 앞이어야 판정 이력이 그 버전을 가리킨다. `quote`·`repro` 는 판정과 무관하게 뒤에.
- `evidence.yml` 은 `GEMINI_MODEL: gemini-3.1-flash-lite` 로 고정한다(잡 `env`). 자동 선택은 별칭 `gemini-flash-lite-latest`
  로 풀려 조용히 바뀌고 대조 재현성 지표가 흔들린다. 모델을 바꾸는 것은 **따로 커밋**하고 `docs/IMPROVEMENT_PROGRESS.md` 에 적는다.
- 조례·공고는 **최근 45일을 겹쳐** 받는다(뒤늦게 고쳐지는 건). 전부 upsert 라 행이 늘지 않는다.
- `continue-on-error` 는 한 출처가 막혀도 뒤(판정)까지 가게 하려는 것이다. law.go.kr 은 가끔 통째로 막힌다
  — 2주 넘게 안 들어오면 요약에 경고가 뜨고, 반복되면 data.go.kr 중계(`1170000/law/ordinSearchList.do`)로 옮긴다.
- 후보 간 공약 비교(`match_race`)는 선거 때만 생기고 표본 검증을 사람이 한다. `race.yml` 은 2026-09-30 재적재로
  지워진 쌍을 무료 한도(하루 20건) 안에서 매일 이어 채우는 임시 워크플로다 — 호출이 0건이 되면 표본을 보고 지운다.
  18:00 KST 인 이유는 파일 주석(미국 오후 혼잡 시간의 503 회피).
- `run_pledges.sh` 는 선거공보 수집·파싱을 손으로 돌리는 것이다(이어받기 됨). 새 선거는 `--sg`/`--type` 을 더한다.
- 새 단계를 넣으면 '결과 요약' 스텝에 행수·최근값을 한 줄 더한다. 조용히 낡는 것을 보이게 하려는 것이다.
- `digest.yml` 은 매일 돌지만 한 사람에게 한 주 한 통이다(`digest_log` 기본키, 보내기 전에 적고 실패하면 지운다).
  09:10 인 이유: Resend 하루 한도(무료 100통)가 UTC 자정에 풀린다. 한도에 걸리면 멈추고 다음 날 남은 사람부터 잇는다.
  담는 기간은 **수집 시각** 기준 지난주 월 00:00~이번 주 월 00:00(KST)이라 다른 워크플로 시각과 상관없이 겹치거나 빠지지 않는다.
  시크릿(`RESEND_API_KEY`·`MAIL_FROM`)이나 구독 표가 없으면 건너뛰고 0 으로 끝난다(꺼진 상태).
  내용 확인은 `python digest.py --preview 시도 [시군구]`(쓰지도 보내지도 않는다).

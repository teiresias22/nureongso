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
| `evidence.yml` | 월 05:00 | `evidence` | `ordin.py`·`bid.py fetch`+`link`·`expense.py` → `judge.py classify→match→match_ordin→match_bid→decide` |

- `ingest`·`nec` 가 한 그룹인 이유: 둘 다 `member` 를 쓴다. 그룹은 실행 하나 + 대기 하나라서 수동 실행을
  연달아 넣으면 앞의 대기 실행이 취소된다. 하나 끝난 뒤 다음을 넣는다. `ingest.yml` 수동 실행은 `step` 에 단계 하나.
- `evidence.yml` 의 judge 순서는 바꾸지 않는다. classify 를 대조 뒤에 돌렸다가 새로 유형이 붙은 공약
  5,262건이 영영 대조되지 않았다. 네 단계 모두 '아직 안 한 것' 만 집어 새 공약이 없으면 LLM 호출 0건.
- 조례·공고는 **최근 45일을 겹쳐** 받는다(뒤늦게 고쳐지는 건). 전부 upsert 라 행이 늘지 않는다.
- `continue-on-error` 는 한 출처가 막혀도 뒤(판정)까지 가게 하려는 것이다. law.go.kr 은 가끔 통째로 막힌다
  — 2주 넘게 안 들어오면 요약에 경고가 뜨고, 반복되면 data.go.kr 중계(`1170000/law/ordinSearchList.do`)로 옮긴다.
- 후보 간 공약 비교(`match_race`)는 워크플로에 넣지 않는다. 선거 때만 생기고 표본 검증을 사람이 한다.
- `run_pledges.sh` 는 선거공보 수집·파싱을 손으로 돌리는 것이다(이어받기 됨). 새 선거는 `--sg`/`--type` 을 더한다.
- 새 단계를 넣으면 '결과 요약' 스텝에 행수·최근값을 한 줄 더한다. 조용히 낡는 것을 보이게 하려는 것이다.

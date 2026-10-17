# 개선 진행 — 주간 기록 메일 · 공약 판정 근거 이력

브랜치 `feat/district-subscription-evidence` (master 에서 갈라짐, 2026-10-14).
원본 문서: `docs/superpowers/plans/2026-10-12-district-subscription.md`(계획서), `docs/superpowers/specs/2026-10-12-pledge-evidence-tracking.md`(설계서).
두 문서 머리의 '검토 결과' 에 지금 코드와 어긋난 곳과 고친 방법을 적었다.

**이번 작업에서 하지 않은 것(규칙):** 운영 Supabase(nureongso)에 아무것도 실행하지 않았다 — 마이그레이션·SQL 점검·`npm run build` 의
사전 렌더(운영 DB 를 읽는다) 모두. 실제 메일을 보내지 않았고, 비밀값을 코드·git 에 넣지 않았고, 워크플로를 돌리지 않았다.
이 환경에는 로컬 Postgres(psql·postgres·docker)도 없어 `supabase/*.check.sql` 은 **쓰기만 하고 실행하지 못했다**.

## 작업별 결과

| # | 작업 | 커밋 | 확인한 것 |
|---|---|---|---|
| 0 | 두 문서 들이기·검토 결과 | `22b1589`, `95011c4` | 인용 줄 번호를 코드와 대조(대부분 맞음, 어긋난 것은 문서에 `검토:`) |
| 1 | 구독 표·신청/확인/해지 함수 (계획 Task 1) | `5ffc96b` | `subscription.check.sql` 1)~5) 작성 — **미실행** |
| E | 판정 이력·근거 버전 DDL (설계 ③ A–E) | `286b27f`, `5e8a9bc` | `pledge_history.check.sql`(사유 7종 중 7종, anon 권한) 작성 — **미실행**. 기준선·트리거는 따로 뗀 덩어리 |
| 2 | 표결·출결 수집 시각, `digest_due`·`digest_changes` (계획 Task 2 + 설계 변경) | `f786342` | `subscription.check.sql` 6)~9) 작성 — **미실행**. 공약 가지는 `pledge_status_log` |
| J | judge.py: 판 이름·`norm`·`locate`·해시, snapshot·quote·repro, `decide --check`, 증분 대조, 근거 upsert `is distinct from` | `340fc65` | `test_judge.py` 통과. 가짜 DB 로 snapshot·quote·match(증분)·repro·`decide --check` 경로를 돌려 봄(작업용, 커밋 안 함) |
| 3 | 지역 목록 꺼내기·입력 검사 (계획 Task 3) | `cfde4dd` | `subscription.check.mjs` 통과, eslint·tsc 0 |
| 4 | 신청·확인·해지 화면과 POST (계획 Task 4) | `31e8ec5` | 키 셋이 없으면 폼이 안 뜨고 라우트는 `busy`. 가짜 키 + 닿지 않는 DB 로 띄운 dev 서버에서 계획서 Step 4 의 기대값 그대로: `confirm&t=bad`→`done=invalid`, 목록 밖 지역→`invalid`, 숨은 칸→`sent`, 해지 화면에 `구독 해지</button>` |
| W | `/pledge/[id]`, `timeline.ts`, 인물 페이지 링크·'MM.DD 바뀜', `past_term`, `/rules` 3번·llms.txt, CDN 목록 | `f31d210` | `timeline.check.mjs` 통과. 로컬 가짜 PostgREST 로 두 경우를 렌더: 새 표가 있을 때(판정·구절·직전 대비·기록 변화·타임라인) / 새 표·칸이 없을 때(오류 없이 기존 칸만). 숫자 아닌 id → 404 |
| 5 | digest.py 주 계산·지역 풀이·문구·보내기 (계획 Task 5 + 설계 변경) | `cb8890d` | `test_digest.py` 통과(공약 줄 `이전 → 지금` + `/pledge/[id]`) |
| 6 | 매일 발송 본체·`digest.yml`·문서 (계획 Task 6) | `7bff019` | 키 없음 → 건너뛰고 0 종료 확인. 가짜 DB·가짜 Resend 로 발송 루프: 429 에서 멈춤, 실패한 사람의 `digest_log` 를 지움, `Idempotency-Key` |
| M | `evidence.yml` 에 snapshot·quote·repro, 요약 지표 | `5be7bc0` | YAML 파싱, 요약 스텝의 파이썬 컴파일 |
| D | 소유자 결정 D: `evidence.yml` `GEMINI_MODEL: gemini-3.1-flash-lite` 고정 | `ba60f99` | YAML 파싱, 요약 스텝 컴파일 |
| Q | 소유자 결정 E: 구절 확인은 '완료' 조건이 아니다 — `/pledge/[id]` 표시만 | `2f38922` | eslint·tsc 0, 규칙표(`DECIDE_SQL`) 그대로 |

매 작업 뒤 돌린 것(마지막 회차 결과):

- collector 테스트 11개 전부 통과(`test_judge`·`test_digest` 새로).
- `node web/src/lib/{force,subscription,timeline}.check.mjs` 통과.
- `eslint` 0, `tsc --noEmit` 0.
- `next build`: 컴파일·TypeScript 통과. 사전 렌더(`/sitemap.xml` 등)는 DB 를 읽어야 해서 닿지 않는 주소로 돌리면 거기서 멈춘다 —
  `master` 에서도 같다. 운영 DB 를 읽는 `npm run build` 는 이번에 돌리지 않았다(아래 수동 확인 1).

## 계획·설계와 다르게 한 것

- 공약 '새 기록' 은 `pledge_status.updated_at` 이 아니라 `pledge_status_log` 에서 상태가 바뀐 줄(`reason <> 'rule'`). updated_at 은 신뢰도만 바뀌어도 움직인다(`judge.py` DECIDE_SQL).
- 켜는 스위치: 웹은 `SUPABASE_SERVICE_ROLE_KEY`·`RESEND_API_KEY`·`MAIL_FROM` 이 다 있어야 폼이 뜬다(`lib/subscription.ts subscriptionOn`), `digest.py` 는 키나 `subscriber` 표가 없으면 건너뛴다.
- 대안 연결: master 의 `9775543`·`8866968` 이 원안 → 대안을 `bill.alt_bill_id`(`ingest.LINK_ALT_SQL`)로 옮겼다. 병합하면서 `bill_alt` 뷰도
  그 칸을 읽게 바꿨다 — `DECIDE_SQL` 과 뷰가 같은 칸을 읽으니 따로 바꿀 것이 없다(전에 적은 '`bill_alt` 로 바꾸는 커밋' 은 없어졌다).
- **모델 고정(소유자 결정 D, 설계 열린 질문 5)**: `evidence.yml` 잡 `env` 에 `GEMINI_MODEL: gemini-3.1-flash-lite`.
  자동 선택(`llm.py gemini_pick`, flash-lite 우선)은 실제로 별칭 `gemini-flash-lite-latest` 로 풀려(이름 역순 정렬) 구글이 별칭을 옮기면
  조용히 바뀐다. 별칭 대신 같은 계열의 판 이름을 박았다(이 저장소 작업 기록에서 쓴 판 이름; API 를 불러 확인하지는 않았다).
  설계서 처음 기본값 3.5-flash 는 무료 한도 하루 20건이라 주간 대조를 못 감당한다.
  **모델을 바꾸는 것은 따로 커밋한다** — 이 줄과 `scheduler.md`·`integrations.md`·`.env.example` 을 같이 고친다. 근거 행의 `model` 칸은 그대로 실제 모델을 남긴다.
- **구절 확인(소유자 결정 E, 설계 열린 질문 1)**: '완료' 조건에 넣지 않는다. 판정 규칙은 그대로이고 `/pledge/[id]` 판정 칸에
  '원문 구절 확인됨 (근거 N건 중 M건) — 판정에는 쓰지 않는 표시', 근거 줄마다 '✓ 원문 구절 확인됨'. `/rules` 3번에도 한 줄.
  **운영 데이터 몇 주 뒤 다시 본다** — `evidence.yml` 요약의 '원문 일치율(AI 가 고른 법안 구절)' 줄이 locate 성공률이다(이제 쓴 모델도 같이 찍는다).
- `quote` 는 연결 때 남긴 `model`·`prompt` 를 덮지 않는다(`coalesce`). 이 칸이 생기기 전 근거만 구절을 고른 모델·판을 적는다.
- 판정 이력의 기준선·트리거는 `schema.sql` 에서 따로 뗀 덩어리다(snapshot 뒤에 돌려야 한다).
- 설계서 ⑧(이력서 성과지표)의 문구는 그대로 두었다. 그 정의대로 재는 줄만 `evidence.yml` 요약에 넣었다.

## 출시 준비 (순서대로, 모두 사용자가)

1. **Resend** 가입 → 보내는 도메인 확인 → API 키 발급.
   - `nureongso.joon.is-a.dev` 를 쓰면 is-a.dev 저장소에 PR 로 Resend 가 알려 주는 레코드(MX·SPF TXT `send.…`, DKIM TXT `resend._domainkey.…`)를 올려야 한다.
     공유 무료 도메인이라 평판이 약할 수 있다 — 따로 도메인을 쓸지 정한다(계획서 '열린 질문').
   - 확인 전에는 Resend 계정 주소로만 간다.
2. **운영 DB 에 SQL 덩어리 적용** — `supabase/schema.sql` 의 `-- ==== … ====` 머리줄 단위로, 수집 워크플로 시각(매일 04:00·09:10·18:00, 화 04:30, 월 05:00 KST)을 피해서.
   덩어리 하나 뽑기: `awk '/^-- ==== /{p = index($0, "<머리줄 이름>") > 0} p' supabase/schema.sql`.
   1. `주간 기록 메일: 구독` — 새 표 둘·함수 셋(기존 표 안 건드림).
   2. `공약 판정 이력·근거 원문` — `bill`·`ordinance`·`bid_notice.created_at`(상수 기본값, 표를 다시 쓰지 않음), `bill_alt` 뷰, `source_version`, `pledge_evidence` 칸 8개·제약·인덱스, `pledge_status_log`·함수 둘·정책.
      적용 전 `evidence.yml` 요약의 DB 용량을 본다(추정 증가: 기준선 ~2.1만 행 ~5MB + 버전·구절 수 MB).
   3. `cd collector && dotenvx run -- .venv/bin/python judge.py snapshot` — 연결 근거 전부의 첫 버전.
   4. `공약 판정 이력: 기준선과 트리거` — 한 트랜잭션. 기준선 수 = `pledge_status` 행 수인지 본다.
   5. `주간 기록 메일: 새 기록` — `vote`·`attendance.created_at`, `digest_due`·`digest_changes`.
   6. 점검(운영 DB 에서 begin…rollback, 파일 머리의 명령): `supabase/subscription.check.sql`, `supabase/pledge_history.check.sql`.
   7. `judge.py decide --check` 가 0 인지 본다(판정 결정성).
3. **비밀값** (값을 채팅·커밋에 적지 않는다)
   - Vercel 환경변수(서버 전용): `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `MAIL_FROM` — 셋이 다 들어가야 `/my` 에 폼이 뜬다.
   - 로컬 `web/.env.local`: `dotenvx set KEY 값 -f .env.local` 로 같은 셋.
   - GitHub Actions Secrets: `RESEND_API_KEY`, `MAIL_FROM`(기존 `DATABASE_URL` 그대로). 로컬 `collector/.env` 는 `dotenvx set`.
4. **병합·배포** — 이 브랜치를 `master` 에 병합(사용자). 2 를 끝내기 전에 병합하면: 폼·주간 메일은 꺼진 채로 있고 `/pledge/[id]` 는 기존 칸만으로 뜨지만,
   월요일 `evidence.yml` 의 대조 셋(`model`·`prompt`·`created_at` 칸을 쓴다)과 snapshot·quote 가 실패한다(전부 continue-on-error 라 판정은 돈다). **2 를 먼저** 한다.
5. **Actions** — `digest.yml` 은 `master` 에 들어간 뒤 매일 09:10 KST 에 돈다. 첫 확인은 Actions 화면에서 수동 실행 한 번, 요약에 `구독 …명 · 확인 대기 …명` 과
   `지난 7일 새로 들어온 법안 …건` 이 찍히는지. 첫 실제 발송은 구독을 확인한 다음 월요일이다.

## 수동 확인

1. 운영 DB 를 읽는 정식 빌드: `cd web && npm run lint && npm run build` — `/pledge/[id]`·`/subscription`·`/api/subscription` 이 `ƒ` 로 나오는지.
2. 내용 미리보기(DB 를 읽기만): `cd collector && dotenvx run -q -- .venv/bin/python digest.py --preview 대구광역시 서구` — 첫 줄의 사람 목록이 `/my?sd=대구광역시&wiw=서구` 화면과 같은지, 문구가 기록 한 줄 + 링크뿐인지.
3. 실제 메일 한 번(자기 주소): `/my?sd=대구광역시&wiw=서구` 에서 신청 → 확인 메일 링크 → '구독 확인' → `done=confirmed` → 해지 링크 → '구독 해지' → `done=stopped`. 운영 DB 에 자기 행 하나를 만들었다 지운다.
   메일 앱의 '구독 해지' 단추(List-Unsubscribe)도 한 번 눌러 본다.
4. `/pledge/<아무 공약 id>` — 판정·근거·타임라인, 인물 페이지 공약 줄의 '판정 이력·원문 근거 →' 링크, 30일 안에 바뀐 판정의 'MM.DD 바뀜'.
5. 첫 월요일 `evidence.yml` 요약: '근거 버전 감지 누락 0', '판정 결정성 0', 원문 일치율·재현성 줄이 찍히는지. `judge.py quote` 는 무료 한도에서 며칠에 나눠 끝난다(`quote_ok is null` 이 줄어드는지).
6. `python sample_review.py match` 로 구절 표본을 사람이 본다(원문 확인/원문에 없음 줄).

## 남은 것 · 열린 문제

- SQL 점검 두 파일은 한 번도 돌지 않았다. 운영 적용 직후 2-6 에서 처음 돈다 — 실패하면 그 assert 메시지가 어긋난 곳이다.
  `subscription.check.sql` 9) 의 첫 assert 는 기존 행이 있는 DB 에서만 참이다.
- 모델 고정·구절 확인은 결정됨(위 '계획·설계와 다르게 한 것').
- 구절 확인을 판정에 넣을지 재검토: 첫 월요일부터 몇 주 '원문 일치율' 을 모은 뒤.
- 로컬 실행(`GEMINI_MODEL` 비움)은 여전히 자동 선택이라 `-latest` 별칭을 고른다. 정기 워크플로는 모두 고정이라 두었다. 막으려면 `gemini_pick` 정규식에 `latest` 를 더한다.
- 증분 대조의 한계(`ponytail:`): 대조와 같은 순간에 커밋 중이던 법안은 since 보다 앞선 시각으로 들어와 빠질 수 있다. 발주 변경공고(차수)는 새 id 라 따라가지 않는다.
- Resend 무료 한도: 하루 100통·월 3,000통(주 ~700명 상한). 넘으면 Pro 또는 SES.
- 이 컴퓨터의 전역 git 설정(`~/.gitconfig` 의 `filter.dotenvx.*`)이 지워진 dotenvx 경로(`/opt/homebrew/Cellar/dotenvx/2.32.2`)를 가리켜 `.env*` 파일을 `git add` 하면 실패한다.
  이번 커밋은 명령마다 `-c filter.dotenvx.protect.process=/opt/homebrew/bin/dotenvx …` 로 넘겼고 설정은 바꾸지 않았다. `dotenvx` 의 git 훅 설정을 다시 하거나 경로를 `/opt/homebrew/bin/dotenvx` 로 고친다.

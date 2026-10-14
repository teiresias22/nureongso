# 누렁소검은소 확장 설계 — 공약 판정이 언제, 어떤 공개 기록 때문에 바뀌었는지 남기는 근거 이력
> 기준: 앱 프로젝트 추천.md §2 · 통합: plans/2026-10-12-district-subscription.md · 작성 2026-10-12 · 상태: 제안(구현 전, 운영 DB 변경은 사용자 승인 필요)

## 검토 결과 (2026-10-14, 브랜치 `feat/district-subscription-evidence` 기준 코드와 대조)

맞는 것: 인용한 자리는 지금 코드와 같다 — 한 번 대조하면 다시 안 함 `judge.py:231-248`(`ingest_run 'match:'`), 대안 조인 `:932-938`, 검수 판정 보호 `:1036-1037`, 신뢰도만 바뀌어도 `updated_at` 이 움직임 `:1039`, LLM 은 연결만 `:12-13`, 모델 자동 선택 `llm.py:128`, 요약은 한 번만 받음 `ingest.py:440-470`, 공약 재생성 `nec.py:564`·`parse_pledges.py:170`, 공약 표 `schema.sql:151-202`, 공개 읽기 `:879-887`, 인물 페이지 임베드 `m/[code]/page.tsx:241-245`, `NOTE_LABEL` 에 `past_term` 없음 `db.ts:91-102`, 모델 고정은 `race.yml:39` 뿐. 근거 upsert 세 곳(`judge.py:295-299`·`:493-497`·`:683-687`)에 `is distinct from` 이 빠져 있다는 것도 맞다(`pledges.md` 규칙 위반). 호환 한자 함정은 `ingest.py:486` 이 아니라 `:481-489`(`people_of` 주석).

고친 것(본문에 `검토:` 로 표시):
1. **`create policy public_read on …` 두 줄**은 다시 실행하면 '이미 있다' 로 실패한다. 파일 앞쪽 `public_read` 배열(`schema.sql:879-887`)은 이 덩어리보다 먼저 돌아 새 표가 아직 없으므로 배열에 넣지 않고, 두 줄 앞에 `drop policy if exists` 를 단다.
2. **`DECIDE_SQL` 을 `bill_alt` 로 바꾸는 것(⑥ 둘째 줄)은 이번에 하지 않는다.** `bill_alt` 가 없는 운영 DB 에 이 브랜치가 먼저 병합되면 월요일 `decide` 가 깨지고, '바꾼 직후 `decide --check` 0행' 은 운영 DB 에서만 확인할 수 있다. 뷰는 만들고(스냅숏·화면이 쓴다) `DECIDE_SQL` 과 서로를 가리키는 주석을 단다(`party_line`/`partyLine` 방식). 운영 DDL 적용 뒤 별도 커밋.
3. **`evidence.yml` 의 `GEMINI_MODEL` 고정(열린 질문 5)** 은 적용하지 않았다. classify·match 의 모델과 무료 한도가 함께 바뀌는 일이라 소유자 결정으로 남긴다. 근거 행의 `model` 칸이 실제 쓴 모델을 남기므로 바뀌면 보인다.
4. **⑧ 이력서 성과지표의 문구는 손대지 않는다**(소유자 지시). 그 정의대로 재는 SQL 만 `evidence.yml` 요약에 단다.
5. **새 표·칸이 없는 DB 에서도 웹이 깨지지 않게** — `/pledge/[id]` 는 기존 칸만으로 먼저 그리고, 새 칸(`quote` 등)·새 표(`pledge_status_log`·`source_version`)는 따로 읽어 실패하면 비운다. 수집기 변경(근거 upsert 의 `model`·`prompt`, 증분 대조의 `created_at`)은 DDL 이 먼저 있어야 한다 — 출시 순서(`docs/IMPROVEMENT_PROGRESS.md`).
6. **운영 DB 적용·백필·점검(③ 백필 1~4, `pledge_history.check.sql`)은 이번 작업에서 실행하지 않는다**(운영 DB 금지, 로컬 Postgres 없음). 트리거 생성문은 `schema.sql` 에 두되, 운영에서는 백필 2(`snapshot`)·3(기준선) 순서로 실행하라고 주석으로 적는다.
7. '기존 계획서 처리' 의 "계획서는 고치지 않고" 는 바꿨다 — 계획서 본문에 같은 변경을 `검토:` 로 적어 두 문서가 같은 말을 한다.

한 줄 요약: 판정은 지금처럼 **공개 규칙표(`DECIDE_SQL`)** 가 하고, 그 판정이 바뀔 때마다 "어떤 근거 기록의 어떤 버전 때문인지"를
남긴다. 새 표는 둘(`source_version`, `pledge_status_log`), 나머지는 기존 `pledge_evidence` 에 칸을 더한다. LLM 은 근거 연결과
원문 구절 고르기만 하고, 구절은 서버가 원문에서 다시 찾아 확인한다.

## 0. 현재 구조와 Gap

| 영역 | 현재(파일 경로) | 목표 | Gap |
|---|---|---|---|
| 수집 파이프라인 | `collector/ingest.py`(법안 매일, `upsert` 가 바뀐 행만 씀), `ordin.py`·`bid.py`(주 1회, 45일 겹쳐 받기), `nec.py`·`bulletin.py`(공약), `.github/workflows/evidence.yml`(월 05:00: 조례·발주 → classify → match ×3 → decide) | 근거 기록이 바뀌면 버전으로 남고, 새 기록이 들어오면 그 사람 대조가 다시 열린다 | ① 버전 없음 — `bill.proc_result` 가 바뀌어도 이전 값이 사라진다. ② **한 번 대조한 사람은 다시 대조하지 않는다**(`judge.py:233-248`, `ingest_run 'match:'` 가 있으면 건너뜀). 임기 중 새로 낸 법안·조례·발주가 공약에 영영 안 붙는다 |
| 데이터 모델/DB | `supabase/schema.sql:151-202` — `pledge_doc`(공보 PDF `pdf_url`·`raw_text`), `pledge`, `pledge_status`(현재 판정 1행, `updated_at`), `pledge_evidence`(kind·ref_id·summary=LLM 이유·score) | 원천 → 버전 → 근거 → 판정 → 변경 이력 | 이력 표 없음(판정이 덮어써진다). 근거에 원문 구절·모델·프롬프트 판·연결 시각 없음 |
| LLM 판정 | `judge.py` classify/match/match_ordin/match_bid(LLM: "이 공약과 이 기록이 같은 일인가"), decide(SQL 규칙표, LLM 없음). 서버 검증은 id 화이트리스트(`pids`/`bids`)·`self_contradicted`·`vague`. `llm.py` temperature 0, 모델은 자동 선택(`gemini_model()` `:128`) | 모든 LLM 연결에 원문 구절 + 모델 + 프롬프트 판 | 원문 구절 없음, 쓴 모델·프롬프트가 어디에도 안 남는다, `evidence.yml` 은 `GEMINI_MODEL` 을 고정하지 않는다(`race.yml` 만 고정) |
| 웹 API/페이지 | `web/src/app/m/[code]/page.tsx:240-244` 가 공약·판정·근거를 임베드로 읽어 인물 페이지 안에 펼친다. 공약 단독 페이지 없음. `lib/db.ts:91-116` `NOTE_LABEL`(`past_term` 빠짐) | 공약 상세(`/pledge/[id]`): 현재 판정·근거 원문·타임라인·이전 대비 차이 | 페이지·타임라인 계산 없음. `/rules` 3번(“공약과 근거는 AI가 연결하고, 원문을 함께 보여줍니다”)에 이력 설명 없음 |
| 분석·로그 | `ingest_run`(수집·대조 실행 기록, `error` 칸), Actions '결과 요약'(DB 용량·판정 분포). 웹 열람 추적은 원칙상 없음(README) | 6개 지표를 SQL·요약 한 줄로 | 원문 일치·재현성·변경 근거 비율을 잴 데이터가 없다 |
| 권한(RLS) | 공개 표는 RLS + `public_read`(`schema.sql:879-887`), 내부 표는 정책 없음, 쓰기 정책 0개(`ops.md`). 계획서가 `subscriber` 를 anon 차단으로 추가 | 새 표 둘은 공개 읽기 | 없음(기존 방식 그대로) |
| 테스트 | `collector/test_*.py`(assert, judge 테스트 없음), `web/src/lib/*.check.mjs`, 계획서 Task 1 이 `supabase/*.check.sql`(begin…rollback) 을 들인다 | 정규화·구절 찾기·사유 판정·타임라인을 점검 | `judge.py` 에 테스트가 하나도 없다 |

### 브리프와 다르게 가는 것 (저장소 규칙을 따름)

| 브리프 | 이 설계 | 이유 |
|---|---|---|
| 상태 '추진 중', 이행률 35%, `score` | 완료·진행·미착수·판단불가 그대로, 공약별 % 없음 | `pledges.md`: 판정은 공개 규칙표, 판단불가≠미이행. 공약 하나의 %는 규칙·데이터 어디에도 근거가 없다(인물 단위 `완료/판정` 비율은 이미 있음) |
| `evaluation(model, prompt_version)` | 판정(`pledge_status`)엔 `rule`(규칙표 판), 모델·프롬프트 판은 **근거 행**에 | LLM 은 판정하지 않고 연결만 한다(`judge.py:12-13`) |
| `document` + `document_version(content, diff)` 신규 | 원천 표(`bill`·`ordinance`·`bid_notice`)가 곧 문서, `source_version` 에는 판정에 쓰이는 칸(facts)과 해시만, diff 는 두 버전 facts 로 그때 계산 | 500MB 무료 한도. `bill.summary` 는 한 번 받으면 다시 안 받아(`ingest.py:440-476`) 본문이 바뀌지 않고, 바뀌는 것은 처리결과 같은 칸이다 |
| 근거 출처: 예산서·추진계획·보도자료 | 법안·조례·발주 셋 그대로 | 예산(`budget_biz` 163MB)은 뺐고, 보도자료는 의견이 섞인 비정형 자료다(README '싣지 않는 것') |
| `evidence(page, section)` | 없음 | 근거 원천에 쪽이 없다(PDF 는 공약 쪽 `pledge_doc` 뿐). 구절 위치는 정규화 본문의 오프셋 |
| "기존 인용 원문 검증" 재사용 | 저장소에 인용 검증은 없다 — id 화이트리스트 자리(같은 '모델 출력은 서버가 다시 확인' 패턴)에 `locate()` 를 새로 둔다 | 실측: `grep` 결과 0건 |
| 근거 제보 화면(검증 대기 → …) | 2차, 기존 GitHub 이슈 양식(`.github/ISSUE_TEMPLATE/data-error.yml`) 확장. 앱 안 제보 저장소 없음 | README '이용자 참여를 붙이지 않는다' — 원문 링크 필수 사실 제보만 받는다 |

## ① 핵심 사용자 시나리오

| # | 상황 | 행동 | 앱이 보여주는 것 | 성공 조건 |
|---|---|---|---|---|
| 1 | 유권자가 구청장 공약 「서구 공영주차장 확충」이 어떻게 됐는지 궁금하다 | `/m/[code]` 공약 줄의 '판정 이력·원문 근거' → `/pledge/[id]` | 현재 판정(진행, 자동 판정, `noteText`), 근거 목록(발주 공고명·원문 구절·원문 링크·연결 모델·확인 날짜), 타임라인(선거 → 공고 → 판정 판단불가→진행), 직전 판정과 다른 점 | 모든 판정 변경 줄에 근거 기록 링크 또는 규칙 사유가 붙어 있고, 원문 구절은 '원문에서 확인'된 것만 보인다 |
| 2 | 국회의원이 낸 법안이 위원회 대안에 반영돼 통과됐다 | (사용자 행동 없음) 매일 `ingest.yml` 이 `bill.proc_result` 를 고치고, 월요일 `evidence.yml` 의 `snapshot` 이 새 버전을, `decide` 가 진행→완료를 만든다 | 타임라인: "2026-12-04 처리: 대안반영폐기 · 대안 원안가결" / "2026-12-07 판정 진행 → 완료 (출처 기록 변화)", 차이: `proc_result: null → 대안반영폐기` | 이력 행의 `reason = 'source'`, `versions` 에 새 버전 id |
| 3 | 구독자(계획서의 주간 메일)가 지난주 바뀐 판정을 알고 싶다 | 월요일 메일을 연다 | `- 공약 판정 「…」 진행 → 완료 (자동 판정)` + `/pledge/[id]` 링크 | 규칙 변경(`reason='rule'`)·기준선은 메일에 안 실린다. 신뢰도만 바뀐 것도 안 실린다 |
| 4 | 운영자(본인)가 AI 연결의 질을 의심한다 | Actions 요약에서 '원문 일치율·구절 없음' 줄을 보고 `sample_review.py match` 로 표본을 본다 | 구절이 원문에 없거나(`quote_ok=false`) 모델이 "해당 부분 없음"(`quote=''`)이라 한 연결 목록 | 일치율이 목표 아래면 `/rules` 3번·프롬프트를 고친다. 프롬프트를 고치면 `PROMPT_VERSION` 이 저절로 바뀐다 |
| 5 | 판정 규칙을 고쳤다(`DECIDE_SQL`) | `decide` 실행 | 바뀐 공약마다 `reason='rule'`, `rule` 에 새 판 | 규칙 때문인 변경과 기록 때문인 변경이 섞이지 않는다 |

## ② 화면 구성

| 화면 | 신규/변경 | 진입점 | 주요 요소 | 빈/오류 상태 |
|---|---|---|---|---|
| `/pledge/[id]` 공약 상세 | 신규 | `/m/[code]` 공약 줄, 주간 메일 링크 | 머리(사람·직위·선거·출처 공약서/선거공보), 현재 판정, 근거(원문 구절), 직전 대비 차이, 타임라인, 선거공보 PDF·오류 제보 링크 | 판정 전: "아직 판정 전입니다(유형 분류 대기)". 근거 0건: `noteText(note)` 만. 구절 미확인: "AI 가 고른 구절이 원문과 달라 싣지 않습니다". 없는 id: `notFound()`. DB 오류: throw(`/bill/[id]` 와 같은 처리) |
| `/m/[code]` 공약 목록 | 변경 | — | 공약 줄 펼침 안에 `판정 이력·원문 근거 →` 링크 한 줄. 판정이 바뀐 지 30일 안이면 배지 옆 "MM.DD 바뀜" | 이력 없으면 표시 없음 |
| `/rules` 3번 | 변경(번호 유지) | — | 원문 구절 확인 방법, 판정 이력의 사유 7종 | — |
| `/llms.txt` | 변경 | — | "판정 이력은 `/pledge/[id]`, 규칙 변경으로 바뀐 판정은 따로 표시" 한 줄 | — |
| 주간 메일(계획서) | 변경 | — | 공약 줄 `이전 → 지금` + `/pledge/[id]` | 기록 없는 주는 안 보냄(계획서 그대로) |

`/pledge/[id]` — 현재 판정·근거·차이·타임라인:

```
┌ 누렁소검은소 ─────────────────────────────────────────────────────┐
│ ← 홍길동 · 서구청장 · 2026 지방선거 대표공약 3                      │
│ 서구 공영주차장 확충                     유형: 예산·사업, 조례·제도  │
├ 지금 판정 ───────────────────────────────────────────────────────┤
│ [진행] 자동 판정  관련 공사가 발주됐습니다 (준공 여부는 확인 불가)   │
│ 2026-10-19 판정 · 규칙 판 3f2a9c1d · 판정 기준 →                    │
├ 직전 판정과 다른 점 ─────────────────────────────────────────────┤
│ 판단불가(관련 기록이 아직 없습니다) → 진행(관련 공사가 발주됐습니다) │
│ 사유: 근거 연결 · 더해진 근거: 발주 공고 ○○동 공영주차장 건립공사    │
├ 타임라인 (일어난 날 / ◇ 우리가 확인한 날) ────────────────────────┤
│ 2026-06-03    공약 (선거공약서)                                      │
│ 2026-09-14    공사 입찰 공고 · ○○동 공영주차장 건립공사 12억    ↗   │
│ ◇2026-10-19  판정 판단불가 → 진행 · 근거 연결                       │
│ 2026-11-02    조례 일부개정 공포 · 서구 주차장 설치 및 관리 조례 ↗   │
│ ◇2026-11-09  판정 사유 바뀜(진행 유지) · 근거 연결                  │
├──────────────────────────────────────────────────────────────────┤
│ 선거공보 원문(PDF) ↗ · 원문과 다른 점 알려주기(GitHub) ↗           │
└──────────────────────────────────────────────────────────────────┘
```

원문 근거 보기(근거 한 건 펼침):

```
│ 근거 법안 · 주차장법 일부개정법률안   [대안반영폐기 → 대안 원안가결] │
│  원문 구절  "지방자치단체가 공영주차장 확보 계획을 수립하도록 …"     │
│             ✓ 제안이유 원문에서 확인 (정규화 본문 212–268자, 버전 2)  │
│  연결       AI(gemini:gemini-3.5-flash · match:9c41e2ab) 2026-10-19   │
│             이유: 공영주차장 확충과 같은 일                          │
│  기록 변화  처리결과 계류 → 대안반영폐기 (2026-12-07 확인)            │
│  법안 상세 /bill/PRC_…  ·  국회 의안정보 ↗                           │
```

- `score`(신뢰도)는 싣지 않는다 — 점수처럼 읽힌다. 모델·프롬프트 판은 작은 글씨로만.
- 타임라인은 **일어난 날**(`proposed_at`·`proc_dt`·`announced_at`·`notice_at`·선거일)과 **확인한 날**(`seen_at`·이력 `at`)을 기호로 가른다. 판정은 주 1회라 '확인한 날'은 월요일에 몰린다.

## ③ DB schema

`supabase/schema.sql` 끝에 `-- ==== 공약 판정 이력·근거 원문 ====` 덩어리로 덧붙인다. **운영 DB 하나뿐이다 — 아래 각 블록은 사용자에게
"무엇을 만들고 기존 행을 바꾸는지"를 알리고 명시적 승인을 받은 뒤**, 수집 시간(매일 04:00·18:00, 화 04:30, 월 05:00, 계획서의 매일 09:10 KST)을
피해 바뀐 문만 실행한다(`ops.md`). `drop`·`truncate` 없음. 적용 전 `evidence.yml` 요약의 DB 용량과
`select count(*), count(distinct (kind, ref_id)) from pledge_evidence` 를 다시 잰다. 추정 증가: 이력 기준선 ~2.1만 행(~5MB) + 버전·구절 수 MB.

```sql
-- A. 수집 시각. 계획서 Task 2 의 bill.created_at 과 같은 칸·같은 방식(if not exists 라 먼저 도는 쪽이 만든다).
--    기존 행은 '-infinity' 상수 — 표를 다시 쓰지 않고(Disk IO), 칸을 단 주에 전부 '새 기록' 이 되지 않는다.
alter table bill       add column if not exists created_at timestamptz not null default '-infinity';
alter table bill       alter column created_at set default now();
alter table ordinance  add column if not exists created_at timestamptz not null default '-infinity';
alter table ordinance  alter column created_at set default now();
alter table bid_notice add column if not exists created_at timestamptz not null default '-infinity';
alter table bid_notice alter column created_at set default now();
create index if not exists ordinance_ordin_id_idx on ordinance (ordin_id);  -- 같은 조례의 다음 제·개정(폐지 포함)을 찾는다

-- B. 대안반영폐기 법안 → 그 대안. DECIDE_SQL 의 alt 조인(judge.py:932-938)을 옮겨 판정·스냅숏·화면이 같은 규칙을 쓴다.
create or replace view bill_alt with (security_invoker = true) as
select b.bill_id, alt.bill_id as alt_id, alt.name as alt_name, alt.proc_result as alt_result, alt.proc_dt as alt_dt
from bill b
join plenary_bill alt
  on b.proc_result = '대안반영폐기' and alt.proc_dt = b.proc_dt
 and alt.name like regexp_replace(b.name, '\s*(일부개정|전부개정|폐지)?법률안.*$', '') || '%'
 and strpos(alt.name, '(대안)') > 0;
grant select on bill_alt to anon, authenticated;

-- C. 근거 기록의 버전(Document Version). 본문은 원천 표에 있고 여기엔 판정에 쓰이는 칸과 해시만 둔다.
--    직전 버전과 해시가 다를 때만 한 줄 — A→B→A 도 세 줄로 남는다.
create table if not exists source_version (
  id           bigserial primary key,
  kind         text not null check (kind in ('bill','ordin','bid')),
  ref_id       text not null,                 -- pledge_evidence.ref_id 와 같은 값
  content_hash text not null,                 -- sha256(canon(norm(본문), facts)) hex, ⑤ 참고
  facts        jsonb not null,                -- bill {name,proc_result,proc_dt,alt_id,alt_result}
                                              -- ordin {last_id,name,rr_kind,effective_at,announced_at} · bid {name,budget,notice_at}
  seen_at      timestamptz not null default now()
);
create index if not exists source_version_ref_idx on source_version (kind, ref_id, id desc);

-- D. 근거(Evidence) = 기존 pledge_evidence. 새 표를 만들지 않는다. 기존 행은 전부 null 로 시작(표를 다시 쓰지 않음).
alter table pledge_evidence
  add column if not exists version_id  bigint references source_version(id) on delete set null,
  add column if not exists quote       text,     -- norm(본문)[quote_start:quote_end] 그대로. '' = 모델이 "해당 부분 없음"
  add column if not exists quote_start int,      -- 유니코드 코드포인트 오프셋(파이썬 str 인덱스)
  add column if not exists quote_end   int,
  add column if not exists quote_ok    boolean,  -- null 미확인 · true 원문에 있음 · false 없음/빈 구절
  add column if not exists model       text,     -- 'gemini:gemini-3.5-flash' | 'reviewer:#123' | null(이 칸 전 연결)
  add column if not exists prompt      text,     -- 'match:9c41e2ab' (judge.PROMPT_VERSION)
  add column if not exists linked_at   timestamptz;  -- 기존 행 null
alter table pledge_evidence alter column linked_at set default now();
alter table pledge_evidence drop constraint if exists pledge_evidence_quote_span;
alter table pledge_evidence add constraint pledge_evidence_quote_span
  check (quote_start is null or (quote_start >= 0 and quote_end > quote_start));
create index if not exists pledge_evidence_ref_idx on pledge_evidence (kind, ref_id);  -- 바뀐 기록 → 영향 공약

-- E. 판정 변경 이력(Event History). 현재 상태는 pledge_status 그대로.
--    공약 원문이 바뀌어 공약이 새로 만들어지면(nec.py:564, parse_pledges.py:170) 이력도 새로 시작한다 — 다른 약속이다.
create table if not exists pledge_status_log (
  id          bigserial primary key,
  pledge_id   bigint not null references pledge(id) on delete cascade,
  at          timestamptz not null default now(),
  status      text not null,
  note        text,
  decided_by  text not null,
  prev_status text,                              -- null = 기준선(첫 줄)
  prev_note   text,
  versions    bigint[] not null default '{}',    -- 그때 연결돼 있던 근거들의 최신 source_version.id
  rule        text,                              -- judge.RULE_VERSION, 사람이 SQL 로 고치면 'manual', 기준선 null
  reason      text not null check (reason in ('baseline','reviewer','evidence','source','rule','elapsed','input'))
);
create index if not exists pledge_status_log_pledge_idx on pledge_status_log (pledge_id, id);
create index if not exists pledge_status_log_at_idx on pledge_status_log (at);   -- 주간 메일·지표

create or replace function pledge_versions(p_pledge bigint) returns bigint[]
language sql stable as $$
  select coalesce(array_agg(v.id order by v.id), '{}')
  from pledge_evidence e
  cross join lateral (select s.id from source_version s
                      where s.kind = e.kind and s.ref_id = e.ref_id order by s.id desc limit 1) v
  where e.pledge_id = p_pledge
$$;

-- 판정을 쓰는 모든 길(decide, 검수자의 SQL Editor)이 여기를 지난다. DECIDE_SQL 의 is distinct from 덕에
-- 바뀐 행에서만 돈다. 신뢰도(confidence)만 바뀐 것은 사건이 아니라 건너뛴다.
create or replace function log_pledge_status() returns trigger
language plpgsql as $$
declare
  prev pledge_status_log;
  v    bigint[] := pledge_versions(new.pledge_id);
  r    text := coalesce(nullif(current_setting('judge.rule', true), ''), 'manual');
  now_refs text[]; prev_refs text[];
begin
  if tg_op = 'UPDATE' and (old.status, old.note, old.decided_by)
     is not distinct from (new.status, new.note, new.decided_by) then
    return null;
  end if;
  select * into prev from pledge_status_log where pledge_id = new.pledge_id order by id desc limit 1;
  select array_agg(kind || ':' || ref_id order by kind, ref_id) into now_refs  from source_version where id = any(v);
  select array_agg(kind || ':' || ref_id order by kind, ref_id) into prev_refs from source_version where id = any(prev.versions);
  insert into pledge_status_log (pledge_id, status, note, decided_by, prev_status, prev_note, versions, rule, reason)
  values (new.pledge_id, new.status, new.note, new.decided_by, prev.status, prev.note, v, r,
    case
      when prev.id is null                      then 'baseline'
      when new.decided_by = 'reviewer'          then 'reviewer'
      when now_refs is distinct from prev_refs  then 'evidence'   -- 근거가 붙거나 떨어짐
      when v is distinct from prev.versions     then 'source'     -- 같은 근거, 원천 기록이 바뀜
      when r <> 'manual' and coalesce(prev.rule, r) not in (r, 'manual') then 'rule'
      when prev.note = 'none_early' and new.note = 'none_2y' then 'elapsed'
      else 'input'                                                 -- 유형 분류·대조 실행 여부가 바뀜
    end);
  return null;
end $$;

alter table source_version    enable row level security;
alter table pledge_status_log enable row level security;
-- 검토: 배열(879-887행)은 이 덩어리보다 먼저 돌아 새 표가 없다. 다시 돌려도 되게 drop 을 앞에 단다.
drop policy if exists public_read on source_version;
create policy public_read on source_version    for select using (true);
drop policy if exists public_read on pledge_status_log;
create policy public_read on pledge_status_log for select using (true);
revoke execute on function pledge_versions(bigint) from public, anon, authenticated;
```

**기존 데이터 백필**(순서가 중요하다 — 기준선의 `versions` 가 비면 첫 변경이 전부 '근거 연결'로 잘못 찍힌다):

1. 위 A–E 적용(트리거는 아직 만들지 않는다).
2. `python judge.py snapshot` — 연결된 근거 전부의 첫 버전(`source_version` 한 ref 당 한 줄).
3. 기준선 + 트리거(한 트랜잭션, 승인 후):
   ```sql
   insert into pledge_status_log (pledge_id, at, status, note, decided_by, versions, rule, reason)
   select s.pledge_id, s.updated_at, s.status, s.note, s.decided_by, pledge_versions(s.pledge_id), null, 'baseline'
   from pledge_status s
   where not exists (select 1 from pledge_status_log l where l.pledge_id = s.pledge_id);
   drop trigger if exists pledge_status_log_trg on pledge_status;
   create trigger pledge_status_log_trg after insert or update on pledge_status
     for each row execute function log_pledge_status();
   ```
4. `python judge.py quote` — 기존 근거의 원문 구절. 조례·발주는 LLM 없이 한 번에, 법안은 사람 단위 호출이라 무료 한도에서 며칠에 나눠 끝난다(`quote_ok is null` 로 이어받기).
5. 지난 판정 이력은 되살릴 수 없다. 기준선 `at` 은 `pledge_status.updated_at`(마지막으로 판정이 바뀐 때)이고 화면에 "기록 시작 시점 판정" 으로 적는다.

## ④ API

### collector (`collector/judge.py`, `collector/llm.py`) — DB 는 `DATABASE_URL`(postgres 역할, RLS 우회)

| 항목 | 시그니처 | 입력 → 출력 | 실패 처리 |
|---|---|---|---|
| 판 상수 | `RULE_VERSION: str`, `PROMPT_VERSION: dict[str, str]` | `sha256(DECIDE_SQL + MP_TERM_START + HEAD_TERM_START + GRACE_YEARS)[:8]`, 프롬프트마다 `'<이름>:' + sha256(PROMPT + json(SCHEMA))[:8]`(이름 match·ordin·bid·quote, 예 `match:9c41e2ab`) — 손으로 올리지 않아 잊을 수 없다 | — |
| 정규화 | `norm(s: str) -> str` | ⑤-1 | — |
| 구절 찾기 | `locate(text: str, quote: str) -> tuple[int, int] \| None` | 정규화 본문·구절 → 코드포인트 구간 | 빈 구절·없음 → `None` |
| 해시 | `content_hash(text: str, facts: dict) -> str` | sha256 hex | — |
| 원천 읽기 | `source_rows(cur, kind: str, ref_ids: list[str]) -> dict[str, tuple[str, dict]]` | `{ref_id: (본문, facts)}`, 원천에서 사라진 ref 는 빠진다 | 한 번의 `= any(%s)` 조회 |
| 스냅숏 | `run_snapshot(conn, check: bool = False) -> tuple[int, set[int]]` · CLI `judge.py snapshot [--check]` | 연결 근거 전부 → (새 버전 수 또는 불일치 수, 영향 공약 id) | LLM 없음. `--check` 는 쓰지 않고 센다(지표 1) |
| 구절 | `run_quote(conn, limit: int \| None) -> None` · CLI `judge.py quote [--limit N]` | `quote_ok is null` 근거 → 구절·구간·`quote_ok`·`version_id`·`model`·`prompt` | `QuotaExhausted` 면 멈춤(다음 실행이 이어받음), `LLMError` 는 그 사람만 건너뜀 — 재시도 루프 없음(`integrations.md`) |
| 대조 1회 | `match_once(pledges, bills) -> set[tuple[int, str, float, str]]` | `run_match` 의 LLM 호출 + id·자기모순 거르기를 꺼낸 것(`run_match`·`run_repro` 가 같이 쓴다) | `LLMError` 그대로 올림 |
| 재현성 | `run_repro(conn, n: int) -> tuple[int, int]` · CLI `judge.py repro --n 5` | 표본 n명 대조 2회 → (일치 사람 수, n). `ingest_run` 에 `source='repro:' + PROMPT_VERSION['match'] + ':' + n`(예 `repro:match:9c41e2ab:5`), `rows=<일치 수>`. `ponytail:` 분모를 source 끝에 싣는다 — 지표가 늘면 표로 | DB 에 근거를 쓰지 않는다 |
| 판정 | `run_decide(conn, check: bool = False) -> int` | 실행 전 `select set_config('judge.rule', RULE_VERSION, true)` → 트리거가 이력에 판을 남긴다. `check=True` 면 실행 후 rollback 하고 바뀔 행 수만(결정성 점검, `member_stats` refresh 안 함) | — |
| 대조 3종 | `run_match`·`run_match_ordin`·`run_match_bid` (시그니처 그대로) | 대상에 **"마지막 대조 뒤 새로 들어온 기록이 있는 사람"** 추가, 그 새 기록만 후보로. 근거 upsert 에 `model`·`prompt`, 그리고 빠져 있던 `where (score, summary, model, prompt) is distinct from (…)` | 기존과 같음 |
| 모델 이름 | `llm.model_id() -> str` | `'gemini:' + gemini_model()` / `'anthropic:' + ANTHROPIC_MODEL` / `'ollama:' + OLLAMA_MODEL` | — |
| 표본 검수 | `sample_review.py match` | `MATCH_SQL` 에 `e.quote, e.quote_ok` 두 칸 | — |

`evidence.yml` 순서: 조례 → 발주 → classify → match → match_ordin → match_bid → **snapshot** → decide → **snapshot --check**(지표 1) → **quote**(continue-on-error) → **repro --n 5**(continue-on-error) → 결과 요약.
LLM 단계에 `GEMINI_MODEL` 을 고정한다(`race.yml:39` 처럼, 열린 질문 5). 요약에 지표 줄을 더한다(`scheduler.md`: 새 단계는 요약 한 줄).

### DB (SQL)

| 항목 | 시그니처 | 권한 | 비고 |
|---|---|---|---|
| `bill_alt` 뷰 | `(bill_id, alt_id, alt_name, alt_result, alt_dt)` | anon 읽기 | `DECIDE_SQL` 의 alt 조인을 이 뷰로 바꾼다 — 바꾼 직후 `decide --check` 가 0 이어야 한다 |
| `pledge_versions(bigint) returns bigint[]` | stable | anon 실행 안 됨 | 트리거·백필 공용 |
| `log_pledge_status()` + `pledge_status_log_trg` | `after insert or update on pledge_status` | — | 사유 7종 |
| 계획서 `digest_changes(...)` 의 'pledge' 가지 | 행 모양 그대로 + `data.prev` | 계획서대로 | 아래 '기존 계획서 처리' |

### web (Next.js 16 서버 컴포넌트, 읽기만 — RPC·route handler 없음)

| 항목 | 시그니처 | 읽는 것 | 실패 처리 |
|---|---|---|---|
| `web/src/app/pledge/[id]/page.tsx` | `export const revalidate = 3600`, `generateMetadata({ params }: { params: Promise<{ id: string }> })`, `default async function PledgePage({ params })` | 1차 `Promise.all`: `pledge`(`id, title, body, category, kinds, election_id, source, doc_id, member(code,name,office), pledge_status(status, decided_by, note, updated_at), pledge_evidence(id, kind, ref_id, summary, quote, quote_ok, model, prompt, linked_at, source_version(id, facts, seen_at))`), `pledge_status_log`(`.eq('pledge_id', id).order('id')`). 2차: `source_version.in('ref_id', refs)`, `bill.in('bill_id')`, `bill_alt.in('bill_id')`, `ordinance.in('id')`, `bid_notice.in('id')`, `pledge_doc_link.eq('id', doc_id)` | id 가 숫자 아님·행 없음 → `notFound()`, DB 오류 → throw. 메타 설명은 실제 값만(`판정 · noteText`) |
| `web/src/lib/timeline.ts` | `export function timeline(i: TimelineInput): TEvent[]`, `export function versionDiff(prev: Facts \| null, cur: Facts): [key: string, from: unknown, to: unknown][]`, `export const REASON_LABEL: Record<string, string>` | 순수 계산(import 없음 → `node` 가 바로 읽는다) | — |
| `web/src/lib/db.ts` | `NOTE_LABEL.past_term = "지난 임기 공약이라 판정하지 않습니다"` 추가 | 지금도 `past_term` 이 날 글자로 보인다 | — |
| `web/next.config.ts` | CDN 하루 캐시 목록에 `"/pledge/:path*"` | 함수 CPU 85% 사용 중(`ops.md`) | — |

`sitemap.ts` 에는 넣지 않는다 — 공약 2.1만 건은 PostgREST 1000행에 잘리고, 크롤러는 인물 페이지 링크로 따라간다(법안과 같은 방식).

## ⑤ 알고리즘

**⑤-1 정규화·해시·구절 찾기** — 오프셋은 이 정규화 본문 위의 코드포인트 위치다. 정규화는 파이썬 한 곳(`judge.norm`)뿐이고 웹은 저장된 `quote` 만 보여 준다.

```python
WS = re.compile(r"[\t\n\v\f\r \x85  ]+")       # NFKC 뒤의 공백류(U+00A0·U+3000 은 NFKC 가 ' ' 로 편다)
def norm(s):  return WS.sub(" ", unicodedata.normalize("NFKC", s).replace("\x00", "")).strip()
#   NFKC: 호환 한자(李 U+F9E1, ingest.py:486 의 함정)·전각 문자를 편다. 따옴표 모양(“ ")·줄임표는 바꾸지 않는다.
def source_text(kind, row): return row.name + "\n" + (row.summary or "") if kind == "bill" else row.name
def content_hash(text, facts):
    return sha256(json.dumps({"t": norm(text), **facts}, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()
def locate(text, quote):                               # text 는 norm 된 본문
    q = norm(quote)
    i = text.find(q) if q else -1                      # 처음 나온 곳. 퍼지 매칭 없음 — 바꾼 글자는 원문 구절이 아니다
    return (i, i + len(q)) if i >= 0 else None
```

**⑤-2 스냅숏(버전 생성 → 영향 공약)**

```python
def run_snapshot(conn, check=False):
    refs   = select distinct kind, ref_id from pledge_evidence where kind in ('bill','ordin','bid')
    latest = select distinct on (kind, ref_id) kind, ref_id, id, content_hash from source_version order by kind, ref_id, id desc
    new = []
    for kind, ids in group(refs):
        for ref, (text, facts) in source_rows(cur, kind, ids).items():   # bill ⋈ bill_alt / ordinance ⋈ lateral(같은 ordin_id 의 최신 행) / bid_notice
            h = content_hash(text, facts)
            if latest.get((kind, ref), {}).get("hash") != h: new.append((kind, ref, h, facts))
    if check: return len(new), set()                                  # 판정 직후 0 이어야 한다
    insert new → source_version
    affected = select pledge_id from pledge_evidence where (kind, ref_id) in new          # 인덱스 pledge_evidence_ref_idx
    for e in evidence on changed refs with quote is not null:                              # 같은 구절을 새 본문에서 다시 찾는다
        span = locate(norm(text), e.quote); update version_id, quote_start/end, quote_ok where … is distinct from …
    print(f"[snapshot] 새 버전 {len(new)} · 영향 공약 {len(affected)}")
```

`decide` 는 원래 전체 공약을 SQL 로 다시 계산(LLM 없음)하므로 '영향 공약 선별'은 LLM 이 드는 곳 — **새 기록과의 대조** — 에서만 쓴다:

```python
# run_match: 아직 안 돈 사람 + 마지막 대조 뒤 새 대표발의가 들어온 사람. 후보는 그 새 법안만(기존 연결은 그대로).
since[code] = select max(finished_at) from ingest_run where source = 'match:' || code
targets = members with 입법 공약 and (since is null or exists rep bill b where b.created_at > since)
bills   = rep bills of code (all if since is null else created_at > since)
rows    = match_once(pledges, bills)                    # 프롬프트·id 거르기·self_contradicted 그대로
upsert pledge_evidence(+model=llm.model_id(), prompt=PROMPT_VERSION['match'], guard is distinct from); log_run('match:'+code)
# run_match_ordin / run_match_bid: 같은 since, 후보 SQL 에 `and o.created_at > %(since)s` 한 줄 — 기존 prefilter
#   (word_similarity > ORDIN_SIM 0.3 / BID_SIM 0.2, 상위 40) 를 새 행에만 건다. 후보 0건이면 지금처럼 log_run(…, 0).
```

**⑤-3 구절 추출·검증 → 판정 → 이력**

```python
def run_quote(conn, limit):
    for e in evidence where quote_ok is null and kind in ('ordin','bid'):              # LLM 없음
        t = norm(name); set quote=t, quote_start=0, quote_end=len(t), quote_ok=true, version_id=latest
    for code, items in group_by_member(evidence where quote_ok is null and kind = 'bill')[:limit]:
        out = llm.complete_json(QUOTE_PROMPT(items[:30]), QUOTE_SCHEMA)   # 항목: [근거id] 공약 title/body[:150] · 법안 원문 norm(text)[:800]
        for it in out.items if it.id in ids:                              # id 화이트리스트(기존 패턴)
            span = locate(norm(text[it.id]), it.quote)
            set quote=norm(it.quote) if span else norm(it.quote)[:300],   # 찾았으면 본문[start:end] 와 같은 글자
                quote_start/end=span, quote_ok=span is not None,
                version_id=latest, model=llm.model_id(), prompt=PROMPT_VERSION['quote']
# QUOTE_PROMPT 요지: "법안 원문에서 공약과 같은 일을 하는 부분을 한 글자도 바꾸지 말고 옮겨라. 120자 이내, 이어진 한 구간,
#   줄임표로 잇지 말 것. 그런 부분이 없으면 빈 문자열 — 억지로 고르는 쪽이 빠뜨리는 쪽보다 훨씬 해롭다."
def run_decide(conn, check=False):
    set_config('judge.rule', RULE_VERSION, true); execute DECIDE_SQL(alt 조인 → bill_alt); n = rowcount
    if check: rollback; return n
    refresh member_stats; commit                       # 트리거가 바뀐 행마다 pledge_status_log 한 줄(사유는 ③-E)
```

판정 규칙(`DECIDE_SQL` 의 `judged`)은 **바꾸지 않는다**. `quote_ok` 를 판정 조건에 넣는 것은 2차(`/rules` 2번 변경이 따른다).

**복잡도**: L = 연결 근거 ref 수, E = 근거 행, P = 공약(2.1만). snapshot 읽기 O(L)·해시 O(본문 길이 합)·쓰기 O(바뀐 ref). quote LLM 호출 = 구절 없는 법안 근거를 가진 사람 수(사람당 1회, 30건씩). decide O(P) SQL(지금과 같음) + 트리거 O(바뀐 공약 × 그 공약 근거 수), 전부 인덱스 조회. repro 2n 호출/주. `/pledge/[id]` 쿼리 2묶음 7개, 타임라인 O(k log k), k = 그 공약 사건 수(수십).

**엣지 케이스**

| 경우 | 처리 |
|---|---|
| 법안 계류 → 가결 → (주 안에 또 바뀜) | 주 1회 스냅숏이라 중간 값은 접힌다(A→C). `ponytail:` 주 단위, 날마다 필요하면 `ingest.yml` 끝에 `snapshot` |
| 원천 행이 사라짐(공고 삭제 등) | `source_rows` 에서 빠지고 버전을 만들지 않는다 — 마지막 버전이 남는다. 삭제 감지는 2차 |
| 같은 조례의 다음 제·개정·폐지 | 근거 ref 는 그대로, facts 가 같은 `ordin_id` 의 최신 행으로 바뀌어 새 버전(타임라인 '기록 변화'). 규칙표는 그대로라 판정·이력 줄은 안 생긴다(폐지 반영은 열린 질문 6) |
| 발주 변경공고(차수 증가) | 새 id 라 감지 안 함. `ponytail:` 공고번호 단위 추적은 `split_part(id,'-',1)` 식 인덱스로 |
| 신뢰도만 바뀜 | 트리거가 건너뛴다(계획서 `updated_at` 기준의 잘못된 '판정 변경'도 함께 없어짐) |
| 상태는 같고 사유(note)만 바뀜 | 이력 한 줄(타임라인 "사유 바뀜"), 메일에는 안 실림 |
| 검수자가 SQL Editor 로 고침 | `rule='manual'`, `reason='reviewer'`. `DECIDE_SQL` 은 reviewer 행을 덮지 않는다(`judge.py:1036-1037`) |
| 공약 원문이 바뀌어 다시 만들어짐 | 새 id 첫 판정이 `baseline`. 옛 이력은 cascade 로 지워진다 |
| 요약 미수집 법안 | 본문 = 법안명뿐. 다음 주 요약이 들어오면 해시가 바뀌어 새 버전(본문 변화) |
| 모델 구절에 줄임표·바꾼 따옴표·요약 | `locate` 실패 → `quote_ok=false`, 화면에 구절을 안 싣는다 |
| 같은 구절이 두 번 나옴 | 처음 위치. 화면은 구절만 보여 주므로 결과가 같다 |
| 규칙 판 변경과 근거 변경이 같은 주 | 근거 쪽('evidence'/'source')이 먼저 — 출처 추적이 우선 |

**테스트**(네트워크 없음, `testing.md` 방식 — 실측 원문 모양 그대로)

| 파일 | 경우 | 기대 |
|---|---|---|
| `collector/test_judge.py` | `norm("李　達坤\x00 의원\n\n안")` | `"李 達坤 의원 안"`(U+F9E1 → U+674E) |
| 〃 | `locate(norm(법안명+"\n"+요약), "공영주차장 확보 계획을 수립")` / 줄임표 섞인 구절 / `""` | 구간 / `None` / `None` |
| 〃 | `content_hash` 에 facts 키 순서만 다름 · `proc_result` 만 다름 | 같음 · 다름 |
| 〃 | `PROMPT_VERSION['match']` 가 `MATCH_PROMPT` 한 글자 바꾸면 달라짐 | 다름 |
| `supabase/pledge_history.check.sql`(begin…rollback, `ZZ` 코드) | 판정 insert → update(같은 값 + confidence 만) → update(note none_early→none_2y) → 근거·버전 추가 후 update → 같은 ref 새 버전 후 update → `set_config('judge.rule','other')` 후 update → decided_by reviewer | baseline / 줄 없음 / elapsed / evidence / source / rule / reviewer |
| 〃 | anon 으로 `pledge_status_log`·`source_version` 읽기, `pledge_versions()` 실행 | 읽기 됨, 실행 거부 |
| `web/src/lib/timeline.check.mjs` | 선거일·공고·판정 2줄·버전 2개 입력 | 날짜순, 기준선은 "기록 시작 시점", 같은 날은 일어난 일 → 확인한 일 순, `versionDiff` = `[["proc_result", null, "대안반영폐기"]]` |
| 운영 확인 | `DECIDE_SQL` 을 `bill_alt` 로 바꾼 직후 `judge.py decide` 를 `check=True` 로 | 0 행 |

## ⑥ MVP 범위

- [ ] DDL A–E + RLS 적용(사용자 승인) — `pledge_history.check.sql` 통과, 기존 `test_*.py` 그대로 통과.
- [ ] `bill_alt` 로 `DECIDE_SQL` 정리 — 바꾼 직후 `decide --check` 0행(판정 결과 동일). (검토: 운영 DDL 적용 뒤 별도 커밋으로 미룸 — 위 '검토 결과' 2)
- [ ] `judge.py snapshot [--check]` — 첫 실행에 연결 ref 수만큼 버전, 두 번째 실행 0건.
- [ ] 백필(기준선 → 트리거) — `pledge_status_log` 기준선 수 = `pledge_status` 행 수.
- [ ] 판정 이력 트리거 — 다음 `decide` 의 바뀐 행 수 = 그날 새 이력 줄 수(기준선 제외).
- [ ] 증분 대조(match·ordin·bid) — 새 대표발의 1건을 가진 사람이 다음 실행 대상에 들어가고, 새 기록 없는 주는 LLM 호출 0.
- [ ] 근거 행에 `model`·`prompt`·`linked_at` — 새로 붙은 근거 100%에 값이 있다.
- [ ] `judge.py quote` + `locate` 검증 — 조례·발주 근거 전부 `quote_ok=true`, 법안 근거는 `quote_ok is null` 이 매주 줄어든다.
- [ ] `/pledge/[id]` — 현재 판정·근거 원문 구절·직전 대비 차이·타임라인, `npm run lint && npm run build` 통과, CDN 목록 등록.
- [ ] `/m/[code]` 링크·"MM.DD 바뀜", `NOTE_LABEL.past_term`, `/rules` 3번·`/llms.txt` 문구 — 화면·규칙·llms.txt 가 같은 말.
- [ ] `evidence.yml` 단계·요약 지표 6줄(⑧ 중 1–5) — 다음 월요일 요약에 숫자가 찍힌다.
- [ ] 계획서 연동(아래 처리표) — 메일 공약 줄이 `이전 → 지금 + /pledge/[id]`.

**MVP 아님**: 판정 규칙 변경(구절 확인을 '완료' 조건으로), 근거 제보 받기, 원문 문맥 강조(`/bill/[id]` 위 구절 표시), 원천 삭제·발주 차수 추적,
선거공보 쪽 구절(공약 자체의 쪽 번호), 날마다 판정, 텍스트 diff 저장, 판정 점수·%, 새 근거 출처(예산서·보도자료), 웹 열람 추적.

## ⑦ 2차 기능

1. **근거 제보** — `data-error.yml` 에 '빠진 공개 기록(근거)' 선택지와 `pledge` 칸을 더하고, `/pledge/[id]` 에 `?template=data-error.yml&page=…` 로 미리 채운 링크. 검수자가 원문을 확인하면 `pledge_evidence(kind, ref_id, model='reviewer:#이슈번호')` 를 넣고 `decide` → 이력 `reason='evidence'`, 이슈에 '반영'/'기각' 라벨. 문구는 "평가가 잘못됐나요"가 아니라 "원문과 다른 점·빠진 공개 기록"(README). 착수: MVP 4주 운영, 검수 시간을 낼 수 있을 때.
2. **구절 확인을 '완료' 조건으로** — 법안 근거 중 `quote_ok=true` 만 `law_passed`/`law_merged` 에 쓴다. `/rules` 2번·`llms.txt` 동시 변경, 이력엔 `reason='rule'`. 착수: 원문 일치율 4주 연속 목표 이상 + 표본 30건 검수.
3. **원문 문맥 강조** — `/bill/[id]` 제안이유에서 구절 위치 표시. TS 쪽 `norm` 이식(코드포인트 vs UTF-16 차이 처리). 착수: 이용자가 구절만으로 부족하다고 제보할 때.
4. **근거 조례 폐지 반영** — facts 의 `rr_kind='폐지'` 면 '완료'를 내린다(규칙 변경). 착수: 실제 폐지 사례가 생길 때.
5. **날마다 판정** — `ingest.yml` 끝에 `snapshot` + `decide`. 착수: 주 단위 지연이 문제로 제보될 때, `member_stats` refresh 의 Disk IO 를 잰 뒤.
6. **발주 차수·원천 삭제 추적** — 공고번호 식 인덱스, 사라진 ref 에 `facts = {"gone": true}` 버전. 착수: 발주 근거 공약이 메일에 자주 실릴 때.

## ⑧ 이력서 성과지표

| 지표 | 정의(분자/분모) | 측정 방법 | 목표치 | 이력서 문장 템플릿 |
|---|---|---|---|---|
| 문서 변경 감지 누락률 | 판정 직후 `snapshot --check` 불일치 ref 수 / 연결 근거 ref 수(주별) | `evidence.yml` 의 `snapshot --check` → 요약 한 줄. 원천 수집 쪽 누락은 아래 '수집 실패율'로 | 0%(넘으면 경보) | "공개 근거 {N}건의 변경을 해시 버전으로 추적, 판정 시점 감지 누락 {N}%" |
| 평가 근거의 원문 일치율 | `quote_ok = true` / `quote_ok is not null and model like 'gemini:%'`(LLM 이 고른 구절만, 조례·발주 이름 구절 제외). 보조: `quote = ''` 비율 | `select avg((quote_ok)::int) from pledge_evidence where model like 'gemini:%' and quote_ok is not null` | ≥ 90% | "LLM 이 고른 근거 구절 {N}건을 서버에서 원문 대조, 일치율 {N}%" |
| 평가 재현성 | (a) 판정: `decide --check` 직후 바뀔 행 0 = 100%. (b) 근거: 표본 사람 중 같은 프롬프트 판·같은 입력으로 대조 2회의 근거 집합 {(공약, 기록)} 이 완전히 같은 비율 — 판정은 근거 집합과 facts 의 결정적 함수라 판정 재현성 ≥ (b) | `ingest_run` 의 `repro:…:<n>` 행: `sum(rows)::float / sum(split_part(source, ':', -1)::int)` (4주, PG14+ 음수 인덱스) | (a) 100% · (b) ≥ 90% | "규칙 판정 100% 결정적, LLM 근거 연결 재현성 {N}%(표본 {N}명·{N}주)" |
| 데이터 수집 실패율 | `error is not null or finished_at is null` 실행 / 전체 실행(`ingest.py` 단계), 조례·발주는 성공 기록 없는 주 / 예정 주(28일) | `ingest_run` SQL(요약 한 줄) | ≤ 5% | "공공 API {N}종 정기 수집, 4주 실패율 {N}%" |
| 판정 변경 중 근거가 있는 비율 | `pledge_status_log` 중 `prev_status is not null and prev_status <> status and status in ('완료','진행')` 이고 `cardinality(versions) > 0` / 같은 조건 전체 | SQL(요약 한 줄) | 100%(불변식) | "판정 변경 {N}건 전부를 근거 문서 버전에 연결" |
| 사용자 제보 검증률(2차) | '근거 제보' 이슈 중 14일 안에 '반영'·'기각' 라벨로 닫힌 것 / 전체 | `gh issue list --label 근거제보 --state all --json labels,createdAt,closedAt` | ≥ 80% | "근거 제보 {N}건 중 {N}%를 14일 안에 원문 검증" |
| (사용량) 주간 판정 변경·구절 처리 | 주별 이력 줄 수(사유별), 구절 처리 건·LLM 호출 수 | 요약 한 줄 | — | "주 {N}건의 판정 변화를 사유별로 기록" |

## 열린 질문

1. **구절 확인을 판정에 넣나** — 기본: MVP 는 표시·측정만, 규칙표 불변(2차 2).
2. **페이지 경로** — 기본 `/pledge/[id]`(`/bill/[id]` 와 같은 꼴). `/p/[id]` 처럼 짧게 원하면 메일 링크도 함께 바꾼다.
3. **규칙 변경 사건을 메일에** — 기본: 개별 줄은 빼고(`reason <> 'rule'`), 그 주에 규칙 판이 바뀌었으면 "판정 기준이 바뀌었습니다 {SITE}/rules" 한 줄.
4. **판정 주기** — 기본 주 1회 유지(월 05:00). 메일은 지난주 이력을 읽으므로 그대로 맞는다.
5. **`evidence.yml` 모델 고정** — 기본 `GEMINI_MODEL: gemini-3.5-flash`(`race.yml` 과 같은 값, 표본 검수를 거친 모델). 자동 선택(flash-lite)을 유지하면 모델이 조용히 바뀌어 재현성 지표가 흔들린다.
6. **근거 조례가 폐지되면** — 기본: 타임라인에만 보이고 판정은 그대로(2차 4).
7. **공약 재수집 때 이력 cascade** — 기본 cascade(원문이 바뀌면 다른 약속). 남겨야 하면 FK 를 `on delete set null` 로.

## 기존 계획서 처리

`docs/superpowers/plans/2026-10-12-district-subscription.md` 는 ~~고치지 않고~~ (검토: 본문에 `검토:` 로 같은 변경을 적었다) 아래대로 실행 때 바꿔 적용한다.

| 계획서 | 처리 | 바뀌는 것 |
|---|---|---|
| Global Constraints·결정 사항 | 그대로(1줄 변경) | '새 기록 판별'의 "공약은 `pledge_status.updated_at`" → `pledge_status_log.at`. `updated_at` 은 신뢰도만 바뀌어도 움직여(`judge.py:1039`) 판정 변경이 아닌 것이 메일에 실린다 |
| Not in v1 | 변경 | "공약 판정의 이전 값('진행 → 완료')" 줄 삭제 — 이제 된다 |
| Task 1 구독 표·함수 | 그대로 | — |
| Task 2 수집 시각·`digest_changes` | 변경 | `bill.created_at` 은 이 설계 A 에도 있다(`if not exists`, 먼저 적용된 쪽이 만듦). 'pledge' 가지를 `from pledge_status_log l join pledge p … where l.at >= p_from and l.at < p_to and l.prev_status is not null and l.prev_status <> l.status and l.reason <> 'rule'`, `data` 에 `'prev', l.prev_status` 추가. `subscription.check.sql` 8) 의 공약 부분은 `insert '판단불가'(note none_early)` → `update '미착수'(none_2y)` 로 바꿔 `prev=판단불가` 를 확인(트리거 필요 — 이 설계 백필 3 뒤에 실행) |
| Task 3 지역 목록·입력 검사 | 그대로 | — |
| Task 4 신청·확인·해지 화면 | 그대로 | 안내 문구 '공약 판정' 그대로 둬도 맞다 |
| Task 5 `digest.py` | 변경 | `render` 공약 줄 → `- 공약 판정 「{title}」 {prev} → {status} ({자동 판정\|검수})\n  {SITE}/pledge/{pledge_id}`. `test_digest.py` 의 `CHANGES` pledge 항목에 `"prev": "판단불가"`, assert 문자열 같은 꼴로. `JUDGY` 검사 그대로(화살표·판정 이름은 평가어가 아니다) |
| Task 6 실행·`digest.yml`·문서 | 변경(1줄) | 요약의 `pledge_status where updated_at > now() - interval '7 days'` → `pledge_status_log where at > now() - interval '7 days' and prev_status is not null and prev_status <> status` |
| 운영 적용 순서 | 변경 | 아래 |

권장 순서(각 운영 DB 단계는 사용자 승인 후):
1. 계획서 Task 1(독립) — 구독 표.
2. 이 설계 ③ A–E 적용 → `judge.py snapshot` → 백필 3(기준선 + 트리거). 이력 표가 있어야 메일의 공약 가지가 선다.
3. 계획서 Task 2(위 변경) → Task 3 → Task 4.
4. 이 설계 웹(`/pledge/[id]`, `/m/[code]` 링크) 배포 — 메일 링크가 404 가 되지 않게 Task 5 전에.
5. 계획서 Task 5(위 변경) → Task 6(위 변경).
6. 이 설계 `evidence.yml` 단계(quote·repro·요약 지표)와 구절 백필 — 메일과 무관하게 이어서.

대략 공수: 이 설계 MVP 5.5–6.5일(DDL·백필 1, collector 2.5, web 2, 워크플로·문서 0.5–1) + 계획서 변경분 0.5일.

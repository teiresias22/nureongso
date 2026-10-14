# 내 지역 주간 기록 메일 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/my` 에서 시도·시군구를 고른 사람이 메일 주소를 넣으면(이중 확인), 매주 월요일 그 지역 현직(국회의원·시도지사·구시군의장·교육감)에 대해 지난주 새로 수집된 공개 기록(대표발의 법안·본회의 표결 건수·본회의 출결 누적·공약 판정)을 텍스트 메일로 받고, 링크 하나로 해지한다.

**Architecture:** 구독자 표 두 개(`subscriber`·`digest_log`)는 공개 읽기 정책 없이 RLS 만 켜고 anon 권한을 거두며, 쓰기는 Next route handler 하나가 service_role 키로 SQL 함수 세 개(`subscription_request`·`subscription_confirm`·`subscription_stop`)만 부른다. '이번 주 새 기록' 은 수집기가 이미 쓰는 표에 `created_at`(수집 시각) 칸 하나씩을 더해 SQL 함수 `digest_changes()` 로 뽑고, 지역 → 사람 풀이는 `/my` 와 같은 규칙(`member_area` + `member.district`)을 Python 으로 옮겨 쓴다. 발송은 기존 수집기와 같은 GitHub Actions 정기 실행(`digest.yml`)에서 `collector/digest.py` 가 하고, `digest_log (구독자, 주)` 기본키로 한 주 한 통을 지킨다.

**Tech Stack:** Python 3.12 (httpx·psycopg — 기존 의존성만) · Supabase Postgres (plpgsql/sql 함수, RLS) · Next.js 16.3.5 App Router route handler · `@supabase/supabase-js` (기존) · Resend REST API (새 연동 하나, SDK 없이 fetch/httpx) · GitHub Actions cron

## Global Constraints

- 의견·평점·평가 문구를 싣지 않는다(`CLAUDE.md`). 메일은 기록 한 줄 + 사이트 상세 링크(`/m/[code]`, `/bill/[id]`) + `/rules` 링크뿐이다.
- 대표발의와 공동발의는 따로, 공동발의는 합산하지 않는다(`assembly.md`). 메일에는 대표발의만 싣는다.
- 공약 판정은 완료·진행·미착수·판단불가를 그대로 쓰고 '자동 판정' 인지 '검수' 인지 함께 적는다. 판단불가를 미이행으로 바꿔 쓰지 않는다(`pledges.md`).
- 저장하는 개인정보는 메일 주소·지역(`sd_name`·`wiw_name`)·신청/확인 시각뿐이다. IP·열람 추적·링크 추적을 두지 않는다. 해지하면 행을 지우고, 확인하지 않은 주소는 7일 뒤 지운다.
- anon 키는 공개값이다. 쓰기 정책을 새로 만들지 않는다(`ops.md`). 구독 표는 읽기 정책도 없다. service_role 키는 `web/src/app/api/subscription/route.ts` 밖에서 읽지 않는다.
- 스키마 원본은 `supabase/schema.sql` 하나, 마이그레이션 도구 없음. 바뀐 문만 운영 DB 에 실행하고(스테이징 없음) `drop`·`truncate` 는 사용자 확인 뒤에만(`ops.md`, `.claude/hooks/protect.sh`).
- 같은 값을 다시 쓰지 않는다(Disk IO Budget, 2026-09-27 장애). 기존 표에 칸을 더할 때는 **상수 기본값**으로 더해 표를 다시 쓰지 않는다.
- 비밀값은 dotenvx 제자리 암호화. `.env*` 를 직접 쓰지 않고 `dotenvx set KEY 값`, `.env.keys` 는 건드리지 않는다. 비밀값을 채팅·커밋에 적지 않는다.
- 새 pip·npm 의존성 금지. 새 외부 연동은 Resend 하나뿐이다.
- 웹 코드 전에 `web/node_modules/next/dist/docs/` 해당 가이드를 읽는다(`web/AGENTS.md`). DB 읽기는 `src/lib/db.ts` 의 `db` 하나.
- 테스트: pytest·픽스처 없음. collector 는 assert 로 된 `test_*` 함수(네트워크·DB 없이), web 은 `src/lib/*.check.mjs`(순수 계산), DB 는 `supabase/*.check.sql`(`begin … rollback`).
- 커밋: `master` 에 한국어 서술형 한 줄(`~한다`) + 본문에 이유 + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` 는 파일을 명시한다(`git add -A`·`.` 는 훅이 막는다).
- 무료 한도: Vercel 함수 CPU 85% 사용 중(웹 쪽 일은 POST 하나로 최소화), Supabase 500MB, Resend 무료 하루 100통·월 3,000통(한도는 UTC 자정에 풀린다).

---

## 결정 사항 (왜 이렇게 하나)

- **지역 → 사람:** 새 수집 단계가 필요 없다. `/my` 가 이미 `member_area`(선관위 `sd_name`/`wiw_name`) + `member.district` 경계 일치(`inDistrict`)로 국회의원 지역구(여러 시를 묶은 `군산시김제시부안군을` 포함)·시도지사·구시군의장·교육감을 푼다. 발송 쪽은 이 규칙을 `collector/digest.py` 로 옮기고 `party_line()`/`partyLine` 처럼 서로를 가리키는 주석을 단다.
- **메일 서비스:** 저장소에 메일 연동이 없다(`integrations.md`·코드 검색 결과 0건). Resend 하나를 고른다 — 무료 월 3,000통·하루 100통, REST 한 번이라 web(fetch)·collector(httpx) 모두 새 의존성 없음, Vercel 연동이 있고 Supabase 가 인증 메일 SMTP 로 권하는 곳, 사용자 정의 헤더(RFC 8058 원클릭 해지)와 `Idempotency-Key`(24시간) 지원. 한계: 구독자가 하루 ~90명을 넘으면 월요일에 다 못 보내고 다음 날로 넘어가며(매일 실행이 잇는다), 주 ~700명(월 3,000통)을 넘으면 Pro($20/월) 또는 SES 로 옮긴다.
- **새 기록 판별:** 사건 날짜(`proposed_at`·`voted_at`)가 아니라 **수집된 때**로 가른다. 국회 API 가 며칠 늦게 주는 기록이 이미 보낸 주에 떨어져 빠지는 일이 없고, 창이 `[지난주 월 00:00, 이번 주 월 00:00) KST` 로 이어 붙어 겹치지도 않는다. `bill`·`vote`·`attendance` 에 `created_at` 을 '-infinity' 상수로 더하고(기존 행은 어느 주에도 안 잡힌다) 기본값만 `now()` 로 바꾼다. 공약은 `pledge_status.updated_at` 이 이미 '판정이 바뀐 때' 다(`judge.py:1038`).
- **멱등:** `digest_log (subscriber_id, week)` 기본키. 보내기 전에 적고(claim), 못 보내면 지운다. 같은 주 재실행·중복 실행은 아무것도 보내지 않는다. 보내기 요청이 타임아웃으로 실패했는데 실제로는 나간 경우는 `Idempotency-Key = digest-{week}-{id}` 가 24시간 막는다.
- **빈 주:** 보내지 않는다(`digest_log.sent = false` 만 남긴다). 하루 100통 한도를 아끼고, 내용 없는 메일이 매주 오면 스팸 신고가 늘어 새 발송 도메인 평판이 떨어진다. 확인 메일과 신청 폼에 '기록이 없는 주에는 보내지 않습니다' 라고 미리 적는다.
- **남용 방지:** 저장소에 기존 rate-limit 패턴이 없다(쓰기 경로 자체가 처음). IP 를 저장하지 않는 대신 DB 에서 막는다 — 주소마다 확인 메일 10분에 한 통, 전체 한 시간에 30통(`subscription_busy`), 숨은 칸(honeypot), 지역은 `/my` 목록에 있는 값만(확인 메일 제목에 남의 글을 싣지 못하게). 이미 확인된 주소는 신청으로 바뀌지 않고, 어느 경우든 같은 '확인 메일을 보냈습니다' 화면을 보여 구독 여부를 드러내지 않는다.
- **확인·해지 링크:** 메일 본문 링크는 GET 화면(`/subscription?do=…&t=…`)에서 버튼(POST)을 한 번 누르게 한다 — 메일 보안 검사기가 링크를 미리 열어 구독이 확인·해지되는 일을 막는다. 메일 앱의 '구독 해지' 단추는 `List-Unsubscribe`/`List-Unsubscribe-Post` 헤더로 `/api/subscription?do=stop&t=…` 에 바로 POST 한다(원클릭).
- **실행 위치:** 정기 작업은 전부 GitHub Actions 다(`scheduler.md`). 발송도 거기서 한다 — Vercel 함수 CPU 무료 한도가 85% 라 크론을 웹에 두지 않는다. 매일 09:10 KST 에 돈다(Resend 하루 한도가 UTC 자정 = 09:00 KST 에 풀린다).

## File Structure

| 파일 | 할 일 |
|---|---|
| `supabase/schema.sql` (끝에 두 덩어리 추가) | `-- ==== 주간 기록 메일: 구독 ====`: `subscriber`·`digest_log`, RLS·권한, 신청·확인·해지 함수. `-- ==== 주간 기록 메일: 새 기록 ====`: `bill`·`vote`·`attendance.created_at`, `digest_due()`·`digest_changes()` |
| `supabase/subscription.check.sql` (새) | 위 둘의 점검. 운영 DB 에서 `begin … rollback` 으로 돈다 |
| `web/src/lib/area.ts` (새) | `/my` 에서 꺼낸 `Area`·`sido()`·`regionsOf()` — `/my` 고르기와 신청 검증이 같은 목록을 쓴다 |
| `web/src/lib/subscription.ts` (새) | `parseSubscribe()`(메일·지역·숨은 칸 검사), `isToken()` — import 없음(node 가 바로 읽는다) |
| `web/src/lib/subscription.check.mjs` (새) | 위 둘의 점검 |
| `web/src/app/my/page.tsx` (수정) | 지역 도우미를 `area.ts` 에서 가져오고, 결과 아래 구독 신청 폼 |
| `web/src/app/api/subscription/route.ts` (새) | POST `do=subscribe|confirm|stop` → `/subscription?done=…` 303. 확인 메일 발송 |
| `web/src/app/subscription/page.tsx` (새) | 결과 문구, 확인·해지 버튼 화면 |
| `collector/digest.py` (새) | 주 계산·지역 풀이·문구·보내기, 매일 실행 본체, `--preview` |
| `collector/test_digest.py` (새) | 주 경계·지역 풀이·문구(중립)·보내기(429·헤더) |
| `.github/workflows/digest.yml` (새) | 매일 09:10 KST, 동시 실행 그룹 `digest`, 결과 요약 |
| `web/.env.example`, `collector/.env.example` (수정) | `SUPABASE_SERVICE_ROLE_KEY`(web), `RESEND_API_KEY`, `MAIL_FROM` |
| `.claude/rules/testing.md`·`ops.md`·`web.md`·`integrations.md`·`scheduler.md`, `CLAUDE.md`, `README.md` (수정) | 새 점검 방법·시크릿·쓰기 경로·Resend 함정·워크플로 |

## Not in v1

- 웹 푸시, SMS·카카오 알림톡
- 사람 하나만 고르는 구독, 주소 하나로 여러 지역 구독, 지역 바꾸기 화면(해지 후 다시 신청)
- 도로명 주소 지오코딩(시도·시군구 선택만)
- HTML 메일(텍스트 메일만)
- 공동발의, 대표발의 법안의 처리 결과(가결·폐기) 변화, 단체장의 조례 제·개정·발주 공사, 재산 공개, 겸직·국외활동 — 조례는 `judge.ordin_org()` + `ordinance.created_at` 한 칸이면 붙는다
- 공약 판정의 이전 값('진행 → 완료') — 지금 판정만
- 비례대표 의원(지역이 없다 — `/my` 와 같다)
- CAPTCHA·IP 기반 제한, 열람·클릭 추적

---

### Task 1: 구독 표와 신청·확인·해지 함수

**Files:**
- Modify: `supabase/schema.sql` (파일 끝, 941행 뒤에 덧붙임)
- Create: `supabase/subscription.check.sql`
- Modify: `.claude/rules/testing.md:1-5`, 같은 파일 끝

**Interfaces:**
- Consumes: 없음
- Produces:
  - 표 `subscriber(id bigint, email text, sd_name text, wiw_name text default '', token uuid, created_at timestamptz, confirm_sent_at timestamptz, confirmed_at timestamptz)`
  - 표 `digest_log(subscriber_id bigint, week date, sent boolean, at timestamptz)`, 기본키 `(subscriber_id, week)`
  - `subscription_request(p_email text, p_sd text, p_wiw text) returns uuid` — 확인 메일을 보낼 토큰, 보낼 것 없으면 `null`, 전체 한도를 넘으면 예외 메시지 `subscription_busy`
  - `subscription_confirm(p_token uuid) returns boolean`
  - `subscription_stop(p_token uuid) returns boolean`
  - 세 함수 모두 `service_role` 만 실행할 수 있다
  - `supabase/subscription.check.sql` 은 `begin;` 으로 시작해 `rollback;` 으로 끝난다(뒤 Task 가 `rollback;` 바로 앞에 덧붙인다)

- [ ] **Step 1: Write the failing test**

`supabase/subscription.check.sql` 을 만든다.

```sql
-- 구독 표·함수 점검. 운영 DB 하나뿐이라 begin … rollback 안에서만 돈다 — 남는 것이 없다.
-- 실행(collector 에서):
--   dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
-- 또는 SQL Editor 에 통째로 붙여 실행. assert 가 틀리면 그 문장에서 멈춘다.
-- 실제 구독자가 지난 한 시간에 확인 메일을 30통 넘게 받았다면 2) 가 subscription_busy 로 실패한다(그때는 한 시간 뒤 다시).
begin;

-- 1) anon(공개 키)은 구독 표를 읽지도 쓰지도, 함수를 부르지도 못한다
insert into subscriber (email, sd_name, wiw_name) values ('check-rls@example.com', '서울특별시', '종로구');
set local role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from subscriber;
  exception when insufficient_privilege then n := 0;
  end;
  assert n = 0, 'anon 이 subscriber 를 읽었다';
  begin
    select count(*) into n from digest_log;
  exception when insufficient_privilege then n := 0;
  end;
  assert n = 0, 'anon 이 digest_log 를 읽었다';
  begin
    insert into subscriber (email, sd_name) values ('anon@example.com', '서울특별시');
    raise exception 'anon 이 subscriber 에 썼다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_request('anon@example.com', '서울특별시', '');
    raise exception 'anon 이 subscription_request() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_confirm('00000000-0000-0000-0000-000000000000');
    raise exception 'anon 이 subscription_confirm() 을 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform subscription_stop('00000000-0000-0000-0000-000000000000');
    raise exception 'anon 이 subscription_stop() 을 불렀다';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 2) 신청: 새 주소는 토큰, 10분 안에 다시 누르면 null(지역만 바뀐다), 10분 뒤엔 같은 토큰을 다시
do $$
declare t1 uuid; t2 uuid; t3 uuid;
begin
  t1 := subscription_request('  Check-New@Example.com ', '대구광역시', '서구');
  assert t1 is not null, '새 주소에 토큰이 없다';
  assert (select email from subscriber where token = t1) = 'check-new@example.com', '주소를 소문자·공백 제거로 두지 않았다';
  t2 := subscription_request('check-new@example.com', '대구광역시', '달서구');
  assert t2 is null, '10분 안에 확인 메일을 또 보낸다';
  assert (select wiw_name from subscriber where token = t1) = '달서구', '확인 전에는 지역을 바꿀 수 있어야 한다';
  update subscriber set confirm_sent_at = now() - interval '11 minutes' where token = t1;
  t3 := subscription_request('check-new@example.com', '대구광역시', '서구');
  assert t3 = t1, '10분 뒤 다시 보낼 때 토큰이 바뀌었다';
end $$;

-- 3) 확인: 없는 토큰·7일 지난 링크는 안 되고, 맞는 토큰은 된다. 확인된 주소는 신청으로 바뀌지 않는다
do $$
declare t uuid;
begin
  t := (select token from subscriber where email = 'check-new@example.com');
  assert not subscription_confirm(gen_random_uuid()), '없는 토큰으로 확인됐다';
  update subscriber set confirm_sent_at = now() - interval '8 days' where token = t;
  assert not subscription_confirm(t), '7일 지난 링크로 확인됐다';
  update subscriber set confirm_sent_at = now() where token = t;
  assert subscription_confirm(t), '맞는 토큰으로 확인되지 않았다';
  assert (select confirmed_at from subscriber where token = t) is not null, 'confirmed_at 이 비었다';
  assert subscription_confirm(t), '두 번 눌러도 확인 상태여야 한다';
  assert subscription_request('check-new@example.com', '서울특별시', '종로구') is null, '확인된 주소에 또 확인 메일을 보낸다';
  assert (select sd_name from subscriber where token = t) = '대구광역시', '남이 확인된 구독의 지역을 바꿨다';
end $$;

-- 4) 해지: 행을 지우고 발송 기록도 함께 지운다. 두 번째는 false
do $$
declare t uuid; sid bigint;
begin
  select token, id into t, sid from subscriber where email = 'check-new@example.com';
  insert into digest_log (subscriber_id, week, sent) values (sid, date '2026-10-12', true);
  assert subscription_stop(t), '해지되지 않았다';
  assert not exists (select 1 from subscriber where token = t), '해지 뒤에도 주소가 남았다';
  assert not exists (select 1 from digest_log where subscriber_id = sid), '해지 뒤에도 발송 기록이 남았다';
  assert not subscription_stop(t), '없는 구독을 해지했다고 한다';
end $$;

-- 5) 한 시간에 확인 메일 30통이 넘으면 subscription_busy
do $$
begin
  insert into subscriber (email, sd_name, confirm_sent_at)
  select 'check-busy-' || i || '@example.com', '서울특별시', now() from generate_series(1, 30) i;
  begin
    perform subscription_request('check-late@example.com', '서울특별시', '');
    raise exception '한도를 넘었는데 받았다';
  exception when raise_exception then
    assert sqlerrm = 'subscription_busy', sqlerrm;
  end;
end $$;

rollback;
```

`.claude/rules/testing.md` 의 머리(1~5행)를 바꾼다.

```markdown
---
paths:
  - "collector/test_*.py"
  - "web/src/lib/*.check.mjs"
  - "supabase/*.check.sql"
---
```

같은 파일 끝에 한 줄을 더한다.

```markdown
- DB 함수·RLS 는 `supabase/*.check.sql`. 운영 DB 하나뿐이라 `begin … rollback` 안에서 돌고 남는 것이 없다.
  테스트 행은 `@example.com`·`ZZ` 로 시작하는 코드만 쓴다. 실행은 파일 머리 주석의 명령.
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
```
Expected: FAIL — `psycopg.errors.UndefinedTable: relation "subscriber" does not exist`

- [ ] **Step 3: Write minimal implementation**

`supabase/schema.sql` 끝(941행 `grant select on vacant_seat …` 뒤)에 덧붙인다.

```sql

-- ==== 주간 기록 메일: 구독 ====
-- /my 에서 지역을 고르고 메일 주소를 넣은 사람. 메일 주소·지역·신청/확인 시각만 둔다.
-- 해지하면 행을 지운다(남겨 둘 이유가 없다). 확인하지 않은 주소는 digest.py 가 7일 뒤 지운다.
-- token 은 확인·해지 링크의 열쇠다. 로그인이 없으니 이것을 가진 사람이 곧 주인이다.
--
-- 다른 표와 달리 공개 읽기 정책이 없다. RLS 만 켜고 anon·authenticated 권한까지 거둔다 — anon 키는
-- 공개값이라 정책 하나만 잘못 붙어도 메일 주소가 통째로 나간다. 쓰기는 web/src/app/api/subscription/route.ts
-- 가 service_role 키로 아래 세 함수만 부른다. 발송(collector/digest.py)은 postgres 로 직접 붙는다.
create table if not exists subscriber (
  id              bigserial primary key,
  email           text not null unique check (email = lower(email) and length(email) <= 254),
  sd_name         text not null,                 -- /my 의 시도 (광주·전남은 '전남광주통합특별시')
  wiw_name        text not null default '',      -- '' 이면 시도 전체
  token           uuid not null unique default gen_random_uuid(),
  created_at      timestamptz not null default now(),   -- 신청
  confirm_sent_at timestamptz,                           -- 확인 메일을 마지막으로 보낸 때
  confirmed_at    timestamptz                            -- 동의(메일 링크의 '구독 확인')
);
alter table subscriber enable row level security;

-- 주마다 누구를 처리했나. (구독자, 주) 기본키라 같은 주에 두 번 보내지 않는다 — digest.py 는
-- 보내기 전에 여기 먼저 적고, 못 보냈으면 지운다. sent = false 는 그 주 기록이 없어 안 보낸 것.
create table if not exists digest_log (
  subscriber_id bigint  not null references subscriber(id) on delete cascade,
  week          date    not null,                -- 그 주 월요일(KST). 담는 기간은 앞 7일
  sent          boolean not null,
  at            timestamptz not null default now(),
  primary key (subscriber_id, week)
);
alter table digest_log enable row level security;
revoke all on subscriber, digest_log from anon, authenticated;

-- 신청. 확인 메일을 보내야 하면 token, 아니면 null.
-- - 이미 확인된 주소는 아무것도 바꾸지 않는다. 남이 내 구독의 지역을 바꾸지 못하게. 지역을 바꾸려면 해지 후 다시.
-- - 확인 메일은 주소마다 10분에 한 통, 전체 한 시간에 30통까지 — 남의 주소로 메일 폭탄을 쏘는 데 쓰이지
--   않게. IP 를 저장하지 않는 대신 이것으로 막는다. 넘으면 'subscription_busy'.
create or replace function subscription_request(p_email text, p_sd text, p_wiw text) returns uuid
language plpgsql as $$
declare t uuid; last_sent timestamptz;
begin
  if (select count(*) from subscriber where confirm_sent_at > now() - interval '1 hour') >= 30 then
    raise exception 'subscription_busy';
  end if;
  insert into subscriber (email, sd_name, wiw_name) values (lower(trim(p_email)), p_sd, p_wiw)
  on conflict (email) do update set sd_name = excluded.sd_name, wiw_name = excluded.wiw_name
    where subscriber.confirmed_at is null
  returning token, confirm_sent_at into t, last_sent;
  if t is null or last_sent > now() - interval '10 minutes' then
    return null;
  end if;
  update subscriber set confirm_sent_at = now() where token = t;
  return t;
end $$;

-- 확인. 마지막 확인 메일이 7일 안이어야 한다. 이미 확인된 것은 그대로 true(다시 쓰지 않는다).
create or replace function subscription_confirm(p_token uuid) returns boolean
language sql as $$
  update subscriber set confirmed_at = now()
  where token = p_token and confirmed_at is null and confirm_sent_at > now() - interval '7 days';
  select exists (select 1 from subscriber where token = p_token and confirmed_at is not null);
$$;

-- 해지. 행을 지운다(digest_log 도 함께). 없는 토큰이면 false.
create or replace function subscription_stop(p_token uuid) returns boolean
language sql as $$
  with gone as (delete from subscriber where token = p_token returning 1)
  select exists (select 1 from gone);
$$;

revoke execute on function subscription_request(text, text, text), subscription_confirm(uuid), subscription_stop(uuid)
  from public, anon, authenticated;
grant execute on function subscription_request(text, text, text), subscription_confirm(uuid), subscription_stop(uuid)
  to service_role;
```

- [ ] **Step 4: 운영 DB 에 이 덩어리만 적용**

운영 DB 하나뿐이다. 실행 전에 사용자에게 "subscriber·digest_log 표와 함수 셋을 만든다(기존 표는 건드리지 않음)" 고 알린다. 새 표·함수만 만들고 기존 데이터는 바꾸지 않는다.

Run:
```bash
cd collector && awk '/^-- ==== /{p = index($0, "주간 기록 메일: 구독") > 0} p' ../supabase/schema.sql \
  | dotenvx run -q -- .venv/bin/python -c "import os,sys,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(sys.stdin.read()); c.commit(); print('applied')"
```
Expected: `applied`

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
```
Expected: `subscription.check ok`

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/subscription.check.sql .claude/rules/testing.md
git commit -m "$(cat <<'EOF'
구독자 표와 신청·확인·해지 함수를 만든다

내 지역 주간 기록 메일의 첫 쓰기 경로다. anon 키가 공개값이라 구독 표에는 읽기 정책도
두지 않고 anon 권한까지 거둔다 — 정책 하나만 잘못 붙어도 메일 주소가 나간다.
쓰기는 service_role 로 함수 셋만 부른다. IP 를 저장하지 않는 대신 확인 메일을 주소마다
10분에 한 통, 전체 한 시간에 30통으로 막아 남의 주소로 메일을 쏘지 못하게 한다.
이미 확인된 구독은 신청으로 바뀌지 않는다(남이 지역을 바꾸지 못하게).

점검은 운영 DB 에서 begin … rollback 으로 도는 subscription.check.sql.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 수집 시각과 주간 새 기록 함수

**Files:**
- Modify: `supabase/schema.sql` (Task 1 덩어리 뒤에 덧붙임)
- Modify: `supabase/subscription.check.sql` (마지막 `rollback;` 바로 앞에 끼움)

**Interfaces:**
- Consumes: Task 1 의 `subscriber`, `digest_log`
- Produces:
  - 칸 `bill.created_at`, `vote.created_at`, `attendance.created_at` (`timestamptz not null`, 기존 행 `-infinity`, 새 행 `now()`)
  - `digest_due(p_week date) returns table (id bigint, email text, sd_name text, wiw_name text, token uuid)` — `confirmed_at < p_week 00:00 KST` 이고 `digest_log` 에 `(id, p_week)` 가 없는 구독자, `id` 순
  - `digest_changes(p_codes text[], p_from timestamptz, p_to timestamptz) returns table (member_code text, kind text, data jsonb)` — 기간은 `[p_from, p_to)`. `kind` 와 `data` 키:
    - `'bill'`: `bill_id`, `name`, `proposed_at`(문자열 `YYYY-MM-DD` 또는 null) — 대표발의만
    - `'vote'`: `result`(`찬성|반대|기권|불참`), `n`(정수) — 결과별 건수
    - `'attendance'`: `age`, `session_no`, `as_of`, `present`, `days`
    - `'pledge'`: `pledge_id`, `title`, `order_no`, `status`, `decided_by`(`auto|reviewer`)
  - 두 함수 모두 anon·authenticated 가 실행하지 못한다(수집기는 소유자 `postgres`)

- [ ] **Step 1: Write the failing test**

`supabase/subscription.check.sql` 의 마지막 줄 `rollback;` 바로 앞에 끼운다(`rollback;` 은 그대로 맨 끝에 남는다).

```sql
-- 6) anon 은 주간 처리 함수도 부르지 못한다(digest_due 는 메일 주소를 돌려준다)
set local role anon;
do $$
begin
  begin
    perform digest_due(current_date);
    raise exception 'anon 이 digest_due() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
  begin
    perform digest_changes(array['x'], now(), now());
    raise exception 'anon 이 digest_changes() 를 불렀다';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 7) 주마다 한 번: 그 주가 시작되기 전에 확인한 사람만, digest_log 에 적힌 사람은 빼고
do $$
declare a bigint; b bigint; c bigint; n int; wk date := date '2026-10-12';
begin
  insert into subscriber (email, sd_name, confirmed_at)
    values ('check-due-a@example.com', '서울특별시', timestamptz '2026-10-11 23:59+09') returning id into a;
  insert into subscriber (email, sd_name, confirmed_at)
    values ('check-due-b@example.com', '서울특별시', timestamptz '2026-10-12 00:00+09') returning id into b;
  insert into subscriber (email, sd_name) values ('check-due-c@example.com', '서울특별시') returning id into c;
  assert exists (select 1 from digest_due(wk) where id = a), '월요일 전에 확인한 사람이 빠졌다';
  assert not exists (select 1 from digest_due(wk) where id = b), '그 주에 확인한 사람이 들어갔다';
  assert not exists (select 1 from digest_due(wk) where id = c), '확인 안 한 사람이 들어갔다';
  insert into digest_log (subscriber_id, week, sent) values (a, wk, true);
  assert not exists (select 1 from digest_due(wk) where id = a), '이미 처리한 사람을 또 집었다';
  -- digest.py 가 기대는 것: 같은 (사람, 주) 를 두 번 적으면 두 번째는 아무것도 돌려주지 않는다
  insert into digest_log (subscriber_id, week, sent) values (a, wk, true) on conflict do nothing returning 1 into n;
  assert n is null, '같은 주를 두 번 적었다';
  assert exists (select 1 from digest_due(wk + 7) where id = a), '다음 주에는 다시 받아야 한다';
end $$;

-- 8) 새 기록: 기간 안에 수집된 것만, 대표발의만, 표결은 결과별 건수, 끝 시각은 다음 주 몫
do $$
declare f timestamptz := now() - interval '1 day'; t timestamptz := now() + interval '1 day'; pid bigint;
begin
  insert into member (code, name) values ('ZZCHECK1', '점검용');
  insert into bill (bill_id, age, name, created_at) values
    ('ZZB-NEW', 22, '새 법안', now()),
    ('ZZB-OLD', 22, '지난주 법안', now() - interval '8 days'),
    ('ZZB-CO', 22, '공동발의 법안', now());
  insert into bill_sponsor (bill_id, member_code, role) values
    ('ZZB-NEW', 'ZZCHECK1', 'rep'), ('ZZB-OLD', 'ZZCHECK1', 'rep'), ('ZZB-CO', 'ZZCHECK1', 'co');
  insert into vote (bill_id, member_code, result, created_at) values
    ('ZZB-NEW', 'ZZCHECK1', '찬성', now()), ('ZZB-CO', 'ZZCHECK1', '찬성', now()),
    ('ZZB-OLD', 'ZZCHECK1', '반대', now() - interval '8 days');
  insert into attendance (age, name, member_code, session_no, days, present, created_at)
    values (99, '점검용', 'ZZCHECK1', 430, 10, 9, now());
  insert into pledge (member_code, title, order_no) values ('ZZCHECK1', '점검 공약', 1) returning id into pid;
  insert into pledge_status (pledge_id, status, updated_at) values (pid, '진행', now());

  assert (select count(*) from digest_changes(array['ZZCHECK1'], f, t) where kind = 'bill') = 1, '새 대표발의가 하나가 아니다';
  assert (select data->>'bill_id' from digest_changes(array['ZZCHECK1'], f, t) where kind = 'bill') = 'ZZB-NEW', '공동발의나 지난주 법안이 섞였다';
  assert (select (data->>'n')::int from digest_changes(array['ZZCHECK1'], f, t)
          where kind = 'vote' and data->>'result' = '찬성') = 2, '찬성이 2건이 아니다';
  assert not exists (select 1 from digest_changes(array['ZZCHECK1'], f, t)
                     where kind = 'vote' and data->>'result' = '반대'), '기간 밖 표결이 들어왔다';
  assert (select data->>'session_no' from digest_changes(array['ZZCHECK1'], f, t) where kind = 'attendance') = '430', '출결 누적이 없다';
  assert (select data->>'status' || '|' || (data->>'decided_by') from digest_changes(array['ZZCHECK1'], f, t)
          where kind = 'pledge') = '진행|auto', '공약 판정이 없다';
  assert not exists (select 1 from digest_changes(array['ZZCHECK1'], now() - interval '2 days', now())
                     where kind = 'bill'), '기간 끝 시각에 들어온 기록이 이번 주에 들어왔다';
  assert not exists (select 1 from digest_changes(array['ZZ-NOBODY'], f, t)), '다른 사람 기록이 나왔다';
end $$;

-- 9) 칸을 더하기 전부터 있던 행은 '-infinity' — 칸을 더한 주에 법안 전부가 '새 기록' 이 되지 않는다
do $$
begin
  assert (select count(*) from bill where created_at = '-infinity') > 0, '기존 법안이 -infinity 가 아니다';
  insert into bill (bill_id, age, name) values ('ZZB-DEF', 22, '기본값');
  assert (select created_at from bill where bill_id = 'ZZB-DEF') = now(), '새 법안의 created_at 이 now() 가 아니다';
end $$;
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
```
Expected: FAIL — `psycopg.errors.UndefinedFunction: function digest_due(date) does not exist`

- [ ] **Step 3: Write minimal implementation**

`supabase/schema.sql` 끝(Task 1 덩어리 뒤)에 덧붙인다.

```sql

-- ==== 주간 기록 메일: 새 기록 ====
-- '이번 주에 새로 들어온 기록' 을 가르는 시각. 수집기는 이 칸을 쓰지 않아 insert 때의 now() 가 남는다
-- (ingest.upsert·replace 는 넘긴 칸만 쓴다). 사건 날짜(proposed_at·voted_at)로 가르지 않는 이유:
-- 국회 API 가 며칠 늦게 주는 기록이 이미 보낸 주에 떨어져 영영 빠진다. 수집 시각이면 주와 주가 이어 붙는다.
-- 이미 있던 행은 '-infinity' 로 둔다. now() 로 더하면 칸을 더한 주에 법안 1.9만 건이 전부 '새 기록' 이 된다.
-- 상수 기본값으로 더한 뒤 기본값만 now() 로 바꾼다 — 상수라 표를 다시 쓰지 않는다(Disk IO, ops.md).
alter table bill add column if not exists created_at timestamptz not null default '-infinity';
alter table bill alter column created_at set default now();
alter table vote add column if not exists created_at timestamptz not null default '-infinity';
alter table vote alter column created_at set default now();
-- attendance 는 ingest.py attendance 가 내용이 바뀐 날 그 대수를 통째로 다시 넣는다(replace). 그래서 이 칸은
-- '이 누적값이 들어온 때' 다 — 새 회기 파일이 오면 그 대수 전원이 그 주에 한 줄씩 잡힌다.
alter table attendance add column if not exists created_at timestamptz not null default '-infinity';
alter table attendance alter column created_at set default now();
-- 공약은 칸을 더하지 않는다. pledge_status.updated_at 이 이미 '판정이 바뀐 때' 다(judge.py DECIDE_SQL).

-- 이번 주(p_week = 월요일, KST) 메일을 아직 처리하지 않은 확인된 구독자. 그 주가 시작되기 전에 확인한
-- 사람만 — 수요일에 확인하면 다음 월요일부터 받는다.
create or replace function digest_due(p_week date)
returns table (id bigint, email text, sd_name text, wiw_name text, token uuid)
language sql stable as $$
  select s.id, s.email, s.sd_name, s.wiw_name, s.token
  from subscriber s
  where s.confirmed_at < (p_week::timestamp at time zone 'Asia/Seoul')
    and not exists (select 1 from digest_log d where d.subscriber_id = s.id and d.week = p_week)
  order by s.id
$$;

-- 사람들(p_codes)의 [p_from, p_to) 새 기록. 화면과 같은 정의다 — 대표발의만(공동발의는 합산하지 않는다),
-- 표결은 결과별 건수, 출결은 누적값, 공약은 지금 판정과 자동/검수.
create or replace function digest_changes(p_codes text[], p_from timestamptz, p_to timestamptz)
returns table (member_code text, kind text, data jsonb)
language sql stable as $$
  select s.member_code, 'bill'::text,
         jsonb_build_object('bill_id', b.bill_id, 'name', b.name, 'proposed_at', b.proposed_at)
  from bill_sponsor s join bill b on b.bill_id = s.bill_id
  where s.member_code = any(p_codes) and s.role = 'rep'
    and b.created_at >= p_from and b.created_at < p_to
  union all
  select v.member_code, 'vote'::text, jsonb_build_object('result', v.result, 'n', count(*))
  from vote v
  where v.member_code = any(p_codes) and v.created_at >= p_from and v.created_at < p_to
  group by v.member_code, v.result
  union all
  select a.member_code, 'attendance'::text,
         jsonb_build_object('age', a.age, 'session_no', a.session_no, 'as_of', a.as_of,
                            'present', a.present, 'days', a.days)
  from attendance a
  where a.member_code = any(p_codes) and a.created_at >= p_from and a.created_at < p_to
  union all
  select p.member_code, 'pledge'::text,
         jsonb_build_object('pledge_id', p.id, 'title', p.title, 'order_no', p.order_no,
                            'status', st.status, 'decided_by', st.decided_by)
  from pledge_status st join pledge p on p.id = st.pledge_id
  where p.member_code = any(p_codes) and st.updated_at >= p_from and st.updated_at < p_to
$$;

revoke execute on function digest_due(date), digest_changes(text[], timestamptz, timestamptz)
  from public, anon, authenticated;
```

- [ ] **Step 4: 운영 DB 에 이 덩어리만 적용**

`alter table … add column` 은 짧게 표 잠금을 잡는다(표를 다시 쓰지는 않는다). `ingest.yml`(04:00 KST)·`nec.yml`(화 04:30)·`evidence.yml`(월 05:00)이 도는 시간을 피하고, 실행 전에 사용자에게 "bill·vote·attendance 에 created_at 칸을 더한다(기존 행 -infinity)" 고 알린다.

Run:
```bash
cd collector && awk '/^-- ==== /{p = index($0, "주간 기록 메일: 새 기록") > 0} p' ../supabase/schema.sql \
  | dotenvx run -q -- .venv/bin/python -c "import os,sys,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(sys.stdin.read()); c.commit(); print('applied')"
```
Expected: `applied`

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('subscription.check ok')"
```
Expected: `subscription.check ok`

수집기 테스트가 그대로인지도 본다(칸이 늘어도 `upsert`·`replace` 는 넘긴 칸만 쓴다).
```bash
cd collector && for f in test_*.py; do dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('${f%.py}');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]" || echo "FAIL $f"; done
```
Expected: `FAIL` 줄 없음

- [ ] **Step 6: Commit**

```bash
git add supabase/schema.sql supabase/subscription.check.sql
git commit -m "$(cat <<'EOF'
법안·표결·출결에 수집 시각을 달고 주간 새 기록을 뽑는 함수를 만든다

주간 메일의 '지난주 새 기록' 을 사건 날짜가 아니라 수집된 때로 가른다. 국회 API 가
며칠 늦게 주는 기록이 이미 보낸 주에 떨어져 빠지지 않고, 주와 주가 겹치지 않는다.
기존 행은 '-infinity' 상수로 더해 칸을 단 주에 법안 1.9만 건이 새 기록으로 잡히지 않게
하고, 상수 기본값이라 표를 다시 쓰지 않는다(Disk IO). 공약은 pledge_status.updated_at 이
이미 '판정이 바뀐 때' 라 그대로 쓴다.

digest_due 는 그 주가 시작되기 전에 확인했고 digest_log 에 없는 구독자만 집는다 —
같은 주에 두 번 보내지 않는 근거다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 지역 목록을 꺼내고 신청 입력을 검사한다

**Files:**
- Create: `web/src/lib/area.ts`
- Create: `web/src/lib/subscription.ts`
- Create: `web/src/lib/subscription.check.mjs`
- Modify: `web/src/app/my/page.tsx:1-8` (import), `:22-38` (지역 도우미 제거), `:73-86` (목록 만들기)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `web/src/lib/area.ts`: `export type Area = { member_code: string; office: string; sd_name: string | null; wiw_name: string | null }`, `export const sido: (v: string | null) => string`, `export function regionsOf(areas: Area[]): Record<string, string[]>`
  - `web/src/lib/subscription.ts`: `export type Parsed = { ok: true; email: string; sd: string; wiw: string } | { ok: false; why: "bot" | "invalid" }`, `export function parseSubscribe(f: FormData, regions: Record<string, string[]>): Parsed`, `export const isToken: (t: string) => boolean`
  - 폼 칸 이름: `email`, `sd`, `wiw`(시도 전체면 `""`), 숨은 칸 `website`

- [ ] **Step 1: Write the failing test**

`web/src/lib/subscription.check.mjs` 를 만든다.

```js
// 실행: node web/src/lib/subscription.check.mjs  (Node 24 가 .ts 를 그대로 읽는다)
// 구독 신청 폼 검사와 /my 의 시도·시군구 목록. 지역은 목록에 있는 값만 받아야 확인 메일 제목에
// 남의 글을 싣지 못한다.
import assert from "node:assert";
import { regionsOf, sido } from "./area.ts";
import { isToken, parseSubscribe } from "./subscription.ts";

// 비례대표('전국')는 빠지고, 광주·전남은 통합 이름 하나로 묶인다. 시군구는 가나다순.
const regions = regionsOf([
  { member_code: "a", office: "국회의원", sd_name: "대구광역시", wiw_name: "서구" },
  { member_code: "b", office: "구시군의장", sd_name: "대구광역시", wiw_name: "달서구" },
  { member_code: "c", office: "국회의원", sd_name: "전국", wiw_name: null },
  { member_code: "d", office: "시도지사", sd_name: "광주광역시", wiw_name: null },
  { member_code: "e", office: "구시군의장", sd_name: "전라남도", wiw_name: "순천시" },
]);
assert.deepStrictEqual(regions, { 대구광역시: ["달서구", "서구"], 전남광주통합특별시: ["순천시"] });
assert.equal(sido(null), "");
assert.equal(sido("전라남도"), "전남광주통합특별시");

const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const ok = { email: "a@example.com", sd: "대구광역시", wiw: "" };

assert.deepStrictEqual(
  parseSubscribe(form({ email: " Me@Example.COM ", sd: "대구광역시", wiw: "서구" }), regions),
  { ok: true, email: "me@example.com", sd: "대구광역시", wiw: "서구" },
);
assert.deepStrictEqual(parseSubscribe(form(ok), regions), { ok: true, ...ok }); // 시도 전체
// 목록에 없는 지역
assert.deepStrictEqual(parseSubscribe(form({ ...ok, sd: "광고 보러 오세요" }), regions), { ok: false, why: "invalid" });
assert.deepStrictEqual(parseSubscribe(form({ ...ok, wiw: "북구" }), regions), { ok: false, why: "invalid" });
// 메일 주소 모양·길이
assert.deepStrictEqual(parseSubscribe(form({ ...ok, email: "not-an-email" }), regions), { ok: false, why: "invalid" });
assert.deepStrictEqual(parseSubscribe(form({ ...ok, email: `${"a".repeat(250)}@example.com` }), regions), { ok: false, why: "invalid" });
// 사람에게 안 보이는 칸을 채운 봇
assert.deepStrictEqual(parseSubscribe(form({ ...ok, website: "x" }), regions), { ok: false, why: "bot" });

assert(isToken("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
assert(!isToken("3f2504e0") && !isToken("' or 1=1 --") && !isToken(""));
console.log("subscription ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/src/lib/subscription.check.mjs`
Expected: FAIL — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '…/web/src/lib/area.ts'`

- [ ] **Step 3: Write minimal implementation**

`web/src/lib/area.ts` (내용은 `/my` 에 있던 것을 그대로 옮긴다):

```ts
/** 선관위가 주는 시도·시군구. member.district 는 직위마다 모양이 달라 못 쓴다. */
export type Area = {
  member_code: string;
  office: string;
  sd_name: string | null;
  wiw_name: string | null;
};

/** 2026년 지방선거에서 광주·전남이 통합됐다. 새 시도지사·교육감만 통합 이름으로 넘어가고
 *  국회의원·구청장은 옛 시도 이름 그대로라, 합치지 않으면 광주 주민이 자기 시도지사를 놓친다. */
const SD_MERGED: Record<string, string> = {
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};
export const sido = (v: string | null) => (v ? SD_MERGED[v] ?? v : "");

/** 시도 → 시군구 목록(가나다순). /my 고르기와 구독 신청 검사(api/subscription)가 같은 목록을 쓴다.
 *  import 가 없어야 subscription.check.mjs 가 node 로 바로 읽는다. */
export function regionsOf(areas: Area[]): Record<string, string[]> {
  const by = new Map<string, Set<string>>();
  for (const a of areas) {
    // '전국' 은 비례대표다. 지역으로 찾는 화면에 넣을 자리가 없다.
    if (!a.sd_name || a.sd_name === "전국") continue;
    const k = sido(a.sd_name);
    if (!by.has(k)) by.set(k, new Set());
    if (a.wiw_name) by.get(k)!.add(a.wiw_name);
  }
  return Object.fromEntries(
    [...by]
      .sort(([a], [b]) => a.localeCompare(b, "ko"))
      .map(([k, v]) => [k, [...v].sort((x, y) => x.localeCompare(y, "ko"))]),
  );
}
```

`web/src/lib/subscription.ts`:

```ts
/** 구독 신청 폼 읽기와 링크 토큰 모양. api/subscription/route.ts 가 쓴다.
 *  import 가 없어야 subscription.check.mjs 가 node 로 바로 읽는다. */
export type Parsed =
  | { ok: true; email: string; sd: string; wiw: string }
  | { ok: false; why: "bot" | "invalid" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSubscribe(f: FormData, regions: Record<string, string[]>): Parsed {
  // 사람에게는 안 보이는 칸. 채워 왔으면 봇이다 — 받은 척만 한다.
  if (String(f.get("website") ?? "") !== "") return { ok: false, why: "bot" };
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const sd = String(f.get("sd") ?? "");
  const wiw = String(f.get("wiw") ?? "");
  // 지역은 /my 목록에 있는 값만. 확인 메일 제목·본문에 그대로 들어가서, 아무 글자나 받으면
  // 남의 주소로 광고 문구를 보내는 데 쓰인다.
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, why: "invalid" };
  if (!regions[sd] || (wiw !== "" && !regions[sd].includes(wiw))) return { ok: false, why: "invalid" };
  return { ok: true, email, sd, wiw };
}

/** 확인·해지 링크의 토큰(uuid). 모양이 틀리면 DB 까지 가지 않는다(uuid 변환 오류도 막는다). */
export const isToken = (t: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
```

`web/src/app/my/page.tsx` 수정 셋.

(가) 4행 `import { pageOg } from "@/lib/site";` 바로 위에 한 줄을 더한다.

```tsx
import { regionsOf, sido, type Area } from "@/lib/area";
```

(나) 22~38행을 아래 한 줄로 바꾼다(`OFFICE_ORDER` 만 남기고 `Area`·`SD_MERGED`·`sido` 를 지운다).

old:
```tsx
/** 선관위가 주는 시도·시군구. member.district 는 직위마다 모양이 달라 못 쓴다. */
type Area = {
  member_code: string;
  office: string;
  sd_name: string | null;
  wiw_name: string | null;
};

const OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"];

/** 2026년 지방선거에서 광주·전남이 통합됐다. 새 시도지사·교육감만 통합 이름으로 넘어가고
 *  국회의원·구청장은 옛 시도 이름 그대로라, 합치지 않으면 광주 주민이 자기 시도지사를 놓친다. */
const SD_MERGED: Record<string, string> = {
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};
const sido = (v: string | null) => (v ? SD_MERGED[v] ?? v : "");
```
new:
```tsx
const OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"];
```

(다) 73~86행을 바꾼다.

old:
```tsx
  // 시도 → 시군구 목록. 통째로 클라이언트에 넘겨 시도를 고르는 즉시 채운다.
  const byRegion = new Map<string, Set<string>>();
  for (const a of (areas ?? []) as Area[]) {
    // '전국' 은 비례대표다. 지역으로 찾는 화면에 넣을 자리가 없다.
    if (!a.sd_name || a.sd_name === "전국") continue;
    const k = sido(a.sd_name);
    if (!byRegion.has(k)) byRegion.set(k, new Set());
    if (a.wiw_name) byRegion.get(k)!.add(a.wiw_name);
  }
  const regions = Object.fromEntries(
    [...byRegion]
      .sort(([a], [b]) => a.localeCompare(b, "ko"))
      .map(([k, v]) => [k, [...v].sort((x, y) => x.localeCompare(y, "ko"))]),
  );
```
new:
```tsx
  // 시도 → 시군구 목록. 통째로 클라이언트에 넘겨 시도를 고르는 즉시 채운다.
  const regions = regionsOf((areas ?? []) as Area[]);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
node web/src/lib/subscription.check.mjs && node web/src/lib/force.check.mjs && cd web && npm run lint && npm run build
```
Expected: `subscription ok`, `force ok`, 린트 오류 0, 빌드 성공(`/my` 가 `ƒ` 동적 경로로 나온다)

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/area.ts web/src/lib/subscription.ts web/src/lib/subscription.check.mjs web/src/app/my/page.tsx
git commit -m "$(cat <<'EOF'
지역 목록을 /my 밖으로 꺼내고 구독 신청 입력을 검사한다

구독 신청은 /my 에서 고른 시도·시군구를 그대로 받는다. 그 값이 확인 메일 제목에 들어가므로
/my 목록에 있는 값만 받아야 남의 주소로 광고 문구를 보내는 데 쓰이지 않는다. 그래서 /my 의
시도 → 시군구 목록 만들기를 lib/area.ts 로 옮겨 두 곳이 같은 목록을 쓰게 한다.
메일 주소 모양·길이, 숨은 칸(봇), 링크 토큰(uuid) 모양은 lib/subscription.ts 에서 본다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 신청·확인·해지 화면과 POST 하나

먼저 읽는다: `web/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`, `web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.

**Files:**
- Create: `web/src/app/api/subscription/route.ts`
- Create: `web/src/app/subscription/page.tsx`
- Modify: `web/src/app/my/page.tsx` (결과 목록 끝 `하세요.` 문단 뒤 — Task 3 뒤라 원래 155~157행보다 위로 올라가 있다)
- Modify: `web/.env.example` (끝에 덧붙임)
- Modify: `.claude/rules/ops.md:16-18`, `:25`
- Modify: `.claude/rules/web.md:23` 앞
- Modify: `.claude/rules/integrations.md:1-11` (paths), 파일 끝

**Interfaces:**
- Consumes:
  - Task 1: `subscription_request(p_email, p_sd, p_wiw) → uuid | null` (예외 `subscription_busy`), `subscription_confirm(p_token) → boolean`, `subscription_stop(p_token) → boolean`
  - Task 3: `regionsOf(areas: Area[])`, `type Area`, `parseSubscribe(f, regions): Parsed`, `isToken(t)`
  - 기존: `db` (`@/lib/db`), `SITE` (`@/lib/site`)
- Produces:
  - `POST /api/subscription?do=subscribe` (폼 `email`·`sd`·`wiw`·`website`), `POST /api/subscription?do=confirm&t=<uuid>`, `POST /api/subscription?do=stop&t=<uuid>` → 303 `/subscription?done=sent|confirmed|stopped|invalid|busy`
  - `GET /subscription?do=confirm|stop&t=<uuid>` — 버튼 화면
  - Task 5·6 이 메일에 쓰는 주소: 본문 해지 링크 `${SITE}/subscription?do=stop&t=${token}`, `List-Unsubscribe` 헤더 `${SITE}/api/subscription?do=stop&t=${token}`
  - 환경변수(web): `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `MAIL_FROM`

- [ ] **Step 1: Write the failing test**

DB 에 쓰지 않는 길(토큰 모양·지역 검사·봇)만 로컬 개발 서버로 확인한다. 다른 터미널에서 `cd web && npm run dev` 를 띄운 뒤 아래 명령을 그대로 친다.

```bash
B=http://localhost:3000
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$B/api/subscription?do=confirm&t=bad"
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$B/api/subscription?do=subscribe" \
  --data-urlencode 'email=a@example.com' --data-urlencode 'sd=광고 보러 오세요' --data-urlencode 'wiw=' --data-urlencode 'website='
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -X POST "$B/api/subscription?do=subscribe" \
  --data-urlencode 'email=a@example.com' --data-urlencode 'sd=대구광역시' --data-urlencode 'wiw=' --data-urlencode 'website=bot'
curl -s "$B/subscription?do=stop&t=3f2504e0-4f89-11d3-9a0c-0305e82c3301" | grep -o '구독 해지</button>'
curl -s -G "$B/my" --data-urlencode 'sd=대구광역시' --data-urlencode 'wiw=서구' | grep -o 'action="/api/subscription?do=subscribe"'
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 앞 셋은 `404`, 뒤 둘은 아무것도 찍지 않는다(라우트·화면·폼이 없다).

- [ ] **Step 3: Write minimal implementation**

`web/src/app/api/subscription/route.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

import { regionsOf, type Area } from "@/lib/area";
import { db } from "@/lib/db";
import { SITE } from "@/lib/site";
import { isToken, parseSubscribe } from "@/lib/subscription";

/** 주간 기록 메일 신청·확인·해지. 셋 다 POST 이고 결과는 /subscription 화면으로 303.
 *
 *  이 사이트의 유일한 쓰기 경로다. anon 키는 공개값이고 구독 표는 정책 없이 RLS 만 켰으므로
 *  service_role 키로 SQL 함수 셋만 부른다(supabase/schema.sql '주간 기록 메일: 구독').
 *  이 키는 이 파일 밖에서 읽지 않는다. 로그인이 없어 확인·해지 링크의 토큰이 곧 열쇠다.
 *  메일 앱의 '구독 해지' 단추도 여기로 바로 POST 한다(RFC 8058, 본문은 읽지 않는다). */
const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const act = url.searchParams.get("do");
  const back = (done: string) => Response.redirect(new URL(`/subscription?done=${done}`, req.url), 303);

  if (act === "confirm" || act === "stop") {
    const t = url.searchParams.get("t") ?? "";
    if (!isToken(t)) return back("invalid");
    const fn = act === "confirm" ? "subscription_confirm" : "subscription_stop";
    const { data, error } = await admin().rpc(fn, { p_token: t });
    if (error) return back("busy");
    // 해지는 이미 지워진 것도 '해지됨' 이다. 메일 앱이 같은 요청을 두 번 보내기도 한다.
    if (act === "stop") return back("stopped");
    return back(data ? "confirmed" : "invalid");
  }
  if (act !== "subscribe") return back("invalid");

  // 1시간 데이터 캐시를 탄다(db.ts). /my 와 같은 목록이어야 거기서 고른 값이 통과한다.
  const { data: areas } = await db.from("member_area").select("member_code, office, sd_name, wiw_name");
  const f = parseSubscribe(await req.formData(), regionsOf((areas ?? []) as Area[]));
  if (!f.ok) return back(f.why === "bot" ? "sent" : "invalid");

  const { data: token, error } = await admin().rpc("subscription_request", {
    p_email: f.email, p_sd: f.sd, p_wiw: f.wiw,
  });
  // subscription_busy: 한 시간에 확인 메일 30통을 넘겼다(남의 주소로 메일을 쏘지 못하게).
  if (error) return back("busy");
  // token 이 없으면 이미 확인된 주소이거나 10분 안에 보낸 주소다. 어느 쪽인지 알려 주지 않는다.
  // 보내기가 실패하면 10분 뒤에 다시 신청할 수 있다(그 사이 confirm_sent_at 이 막는다).
  const area = [f.sd, f.wiw].filter(Boolean).join(" ");
  if (token && !(await sendConfirm(f.email, area, token))) return back("busy");
  return back("sent");
}

async function sendConfirm(email: string, area: string, token: string): Promise<boolean> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [email],
      subject: `[누렁소검은소] ${area} 주간 기록 메일 구독 확인`,
      text: [
        `${area}의 국회의원·시도지사·구시군의장·교육감에 대해, 지난 한 주 새로 수집된 공개 기록`,
        `(대표발의 법안, 본회의 표결, 본회의 출결, 공약 판정)을 매주 월요일 아침 보내 드립니다.`,
        `기록이 없는 주에는 보내지 않습니다.`,
        ``,
        `아래 주소를 열고 '구독 확인'을 누르면 시작합니다(7일 안).`,
        `${SITE}/subscription?do=confirm&t=${token}`,
        ``,
        `신청하지 않았다면 이 메일을 무시하세요. 확인하지 않은 주소는 7일 뒤 지웁니다.`,
        `저장하는 것: 메일 주소, 고른 지역, 신청·확인 시각.`,
        `— 누렁소검은소 ${SITE}`,
      ].join("\n"),
    }),
  });
  return r.ok;
}
```

`web/src/app/subscription/page.tsx`:

```tsx
import Link from "next/link";

import { isToken } from "@/lib/subscription";

export const metadata = {
  title: "메일 구독",
  robots: { index: false, follow: false },
};

const DONE: Record<string, string> = {
  sent: "확인 메일을 보냈습니다. 메일의 링크를 열어 '구독 확인'을 눌러야 시작됩니다. 이미 확인된 주소에는 다시 보내지 않습니다.",
  confirmed: "구독을 확인했습니다. 다음 주 월요일부터, 고른 지역의 공개 기록이 새로 들어온 주에 메일을 보냅니다.",
  stopped: "구독을 해지했습니다. 메일 주소와 지역을 지웠습니다.",
  invalid: "링크나 입력이 맞지 않습니다. 확인 링크는 7일이 지나면 끊깁니다 — 내 지역 대표에서 다시 신청하세요.",
  busy: "지금은 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.",
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ do?: string; t?: string; done?: string }>;
}) {
  const q = await searchParams;
  const ask = (q.do === "confirm" || q.do === "stop") && isToken(q.t ?? "") ? q.do : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">주간 기록 메일</h1>
      {ask ? (
        // 링크를 여는 것만으로는 바꾸지 않는다. 메일 보안 검사기가 링크를 미리 열어 보는 일이 있어
        // 버튼(POST)을 한 번 누르게 한다. 메일 앱의 '구독 해지' 단추는 api 로 바로 POST 한다.
        <form
          method="post"
          action={`/api/subscription?do=${ask}&t=${q.t}`}
          className="space-y-3 rounded-lg border border-line bg-card p-6"
        >
          <p className="text-sm">
            {ask === "confirm" ? "주간 기록 메일 구독을 확인합니다." : "주간 기록 메일 구독을 해지하고 메일 주소를 지웁니다."}
          </p>
          <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            {ask === "confirm" ? "구독 확인" : "구독 해지"}
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-line bg-card p-6 text-sm">{DONE[q.done ?? ""] ?? DONE.invalid}</p>
      )}
      <p className="text-xs text-muted">
        저장하는 것은 메일 주소, 고른 지역, 신청·확인 시각뿐입니다.{" "}
        <Link href="/my" className="underline underline-offset-2">
          내 지역 대표
        </Link>
      </p>
    </div>
  );
}
```

`web/src/app/my/page.tsx` — 결과 목록 아래(`하세요.` 문단 뒤, 파일에 한 곳뿐이다)에 폼을 넣는다.

old:
```tsx
            하세요.
          </p>
        </>
```
new:
```tsx
            하세요.
          </p>
          {/* 구독 신청. 자바스크립트 없이 도는 보통 폼이다 — 결과는 /subscription 이 보여 준다.
              지역은 위에서 고른 값 그대로 보내고, route 가 이 목록에 있는지 다시 본다. */}
          <form
            method="post"
            action="/api/subscription?do=subscribe"
            className="space-y-2 rounded-lg border border-line bg-card p-4"
          >
            <label htmlFor="sub-email" className="block text-sm font-medium">
              {[sd, wiw].filter(Boolean).join(" ")}의 공개 기록이 새로 들어온 주에 메일 받기
            </label>
            <input type="hidden" name="sd" value={sd} />
            <input type="hidden" name="wiw" value={wiw} />
            {/* 사람에게는 보이지 않는 칸. 채워 오면 봇으로 보고 받은 척만 한다. */}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <div className="flex flex-wrap gap-2">
              <input
                id="sub-email"
                type="email"
                name="email"
                required
                maxLength={254}
                placeholder="메일 주소"
                className="min-w-60 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
              />
              <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
                구독 신청
              </button>
            </div>
            <p className="text-xs text-muted">
              매주 월요일, 지난주에 새로 수집된 대표발의 법안·본회의 표결·출결·공약 판정을 보냅니다. 기록이 없는
              주에는 보내지 않습니다. 메일 주소·지역·신청과 확인 시각만 저장하고, 확인 메일의 링크를 눌러야
              시작합니다. 메일마다 해지 링크가 있습니다.
            </p>
          </form>
        </>
```

`web/.env.example` 끝에 덧붙인다.

```bash

# --- 주간 기록 메일 (app/api/subscription/route.ts) ---
# 서버 전용(NEXT_PUBLIC_ 아님). RLS 를 우회하는 키라 route.ts 밖에서 읽지 않는다.
# Supabase 프로젝트 설정 > API > service_role. 구독 신청·확인·해지 함수만 부른다.
SUPABASE_SERVICE_ROLE_KEY=
# Resend(https://resend.com) API 키. 확인 메일은 web 이, 주간 메일은 collector/digest.py 가 같은 키로 보낸다.
RESEND_API_KEY=
# 보내는 사람. Resend 에서 확인한 도메인이어야 한다. 예: 누렁소검은소 <digest@mail.example.com>
MAIL_FROM=
```

`.claude/rules/ops.md` 수정.

16행 웹 줄의 한 구절을 바꾼다.

old:
```markdown
| 웹 | Vercel, 리전 `icn1` | 환경변수는 Vercel 에. `NEXT_PUBLIC_SITE_URL`
```
new:
```markdown
| 웹 | Vercel, 리전 `icn1` | 환경변수는 Vercel 에(서버 전용 `SUPABASE_SERVICE_ROLE_KEY` `RESEND_API_KEY` `MAIL_FROM` 포함). `NEXT_PUBLIC_SITE_URL`
```

17행을 바꾼다.

old:
```markdown
| 수집 | GitHub Actions | 시크릿: `DATABASE_URL` `ASSEMBLY_API_KEY` `DATA_GO_KR_KEY` `LAW_OC` `GEMINI_API_KEY` |
```
new:
```markdown
| 수집 | GitHub Actions | 시크릿: `DATABASE_URL` `ASSEMBLY_API_KEY` `DATA_GO_KR_KEY` `LAW_OC` `GEMINI_API_KEY` `RESEND_API_KEY` `MAIL_FROM` |
```

18행 LLM 줄 바로 아래에 한 줄을 더한다.

```markdown
| 메일 | Resend 무료 | 하루 100통·월 3,000통, 하루 한도는 UTC 자정(09:00 KST)에 풀린다. 확인 메일(web)과 주간 메일(`digest.yml`)이 같은 키. 보내는 도메인을 Resend 에서 확인해야 한다 |
```

25행을 바꾼다.

old:
```markdown
- anon 키는 공개값이다. 모든 테이블이 RLS 읽기 전용이고 쓰기 정책이 하나도 없다 — 쓰기 정책을 새로 만들지 않는다.
```
new:
```markdown
- anon 키는 공개값이다. 모든 테이블이 RLS 읽기 전용이고 쓰기 정책이 하나도 없다 — 쓰기 정책을 새로 만들지 않는다.
  구독 표(`subscriber`·`digest_log`)는 읽기 정책도 없고 anon 권한을 거뒀다. 쓰기는 `web/src/app/api/subscription/route.ts`
  가 service_role 키로 `subscription_request`·`subscription_confirm`·`subscription_stop` 만 부른다. 그 키는 그 파일 밖에서 읽지 않는다.
```

`.claude/rules/web.md` — 23행(`- 확인: …`) 바로 위에 한 줄을 더한다.

```markdown
- 쓰기는 `app/api/subscription/route.ts` 하나뿐이다(구독 신청·확인·해지, POST → `/subscription` 으로 303). service_role 키는
  거기서만 읽는다. `/subscription` 은 토큰을 읽는 화면이라 CDN 캐시 목록(`next.config.ts`)에 넣지 않는다.
```

`.claude/rules/integrations.md` — 머리 paths(10행 `- "collector/districts.py"` 아래)에 두 줄을 더한다.

```markdown
  - "collector/digest.py"
  - "web/src/app/api/subscription/route.ts"
```

같은 파일 끝에 덧붙인다.

```markdown

## 메일 — Resend (`digest.py`, `api/subscription/route.ts`)
- 무료 하루 100통·월 3,000통. 하루 한도는 **UTC 자정**에 풀린다. 확인 메일(web)도 같은 한도를 쓴다.
- 429 는 이름으로 갈린다: `rate_limit_exceeded`(기본 초당 10건), `daily_quota_exceeded`, `monthly_quota_exceeded`.
  digest.py 는 셋 다 `Quota` 로 깨끗이 멈추고 다음 실행이 잇는다 — 재시도 루프를 넣지 않는다(LLM 과 같다).
- `Idempotency-Key` 는 24시간. 주간 메일은 `digest-{week}-{id}` 를 단다.
- 보내는 도메인은 Resend 에서 확인(SPF·DKIM TXT, MX)해야 한다. 확인 전에는 계정 주소로만 간다.
```

- [ ] **Step 4: Run test to verify it passes**

`npm run dev` 를 다시 띄우고(새 경로를 잡게) Step 1 의 명령을 그대로 친다.

Expected:
```
303 http://localhost:3000/subscription?done=invalid
303 http://localhost:3000/subscription?done=invalid
303 http://localhost:3000/subscription?done=sent
구독 해지</button>
action="/api/subscription?do=subscribe"
```

그리고:
```bash
node web/src/lib/subscription.check.mjs && cd web && npm run lint && npm run build
```
Expected: `subscription ok`, 린트 오류 0, 빌드 성공(`/api/subscription`·`/subscription` 이 `ƒ` 로 나온다)

**사용자가 직접(비밀값·실제 메일):** Resend 계정·도메인 확인 뒤 `cd web && dotenvx set SUPABASE_SERVICE_ROLE_KEY <값> -f .env.local`, `dotenvx set RESEND_API_KEY <값> -f .env.local`, `dotenvx set MAIL_FROM '<보내는 사람>' -f .env.local`, Vercel 환경변수에도 같은 셋. 그다음 `npm run dev` 에서 `/my?sd=대구광역시&wiw=서구` 에 자기 메일로 신청 → 확인 메일의 링크 → '구독 확인' → `/subscription?done=confirmed` → 해지 링크 → '구독 해지' → `done=stopped`. 이 확인은 운영 DB 에 자기 행 하나를 만들었다가 지운다.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/subscription/route.ts web/src/app/subscription/page.tsx web/src/app/my/page.tsx web/.env.example .claude/rules/ops.md .claude/rules/web.md .claude/rules/integrations.md
git commit -m "$(cat <<'EOF'
내 지역 대표에서 주간 기록 메일을 신청·확인·해지하게 한다

/my 결과 아래 메일 주소 칸을 두고, 신청·확인·해지를 POST 하나(api/subscription)로 받는다.
사이트의 첫 쓰기 경로라 service_role 키는 이 파일에서만 읽는다. 메일 본문 링크는 화면에서
버튼을 한 번 누르게 한다 — 메일 보안 검사기가 링크를 미리 열어 구독이 확인·해지되는 일을
막는다. 메일 앱의 해지 단추는 api 로 바로 POST 한다(RFC 8058).

메일 연동이 없어 Resend 하나를 들인다. 무료 하루 100통·월 3천 통이고 REST 한 번이라
web(fetch)·collector(httpx) 모두 새 의존성이 없다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 주간 메일의 주 계산·지역 풀이·문구·보내기

**Files:**
- Create: `collector/digest.py`
- Create: `collector/test_digest.py`
- Modify: `web/src/app/my/page.tsx` (`function inDistrict` 위 주석), `web/src/lib/area.ts` (`regionsOf` 위 주석)

**Interfaces:**
- Consumes: Task 2 의 `digest_changes` 행 모양 `(member_code: str, kind: str, data: dict)` 과 `data` 키, Task 4 의 해지 주소 형식
- Produces (`collector/digest.py`):
  - `KST: ZoneInfo`, `SITE: str = "https://nureongso.joon.is-a.dev"`, `FROM: str | None` (환경변수 `MAIL_FROM`)
  - `week_of(now: datetime) -> date` — KST 월요일
  - `window(week: date) -> tuple[datetime, datetime]` — `[week-7일 00:00 KST, week 00:00 KST)`
  - `sido(v: str | None) -> str`, `in_district(district: str, wiw: str) -> bool`
  - `resolve(rows, sd: str, wiw: str) -> list[tuple[str, str, str]]` — `rows` 는 `(code, office, sd_name, wiw_name, district, name)` 튜플들, 돌려주는 것은 `(code, name, office)` 를 국회의원·구시군의장·시도지사·교육감, 이름 순
  - `render(area: str, people: list[tuple[str, str, str]], changes: list[tuple[str, str, dict]], start: datetime, end: datetime, token: str) -> tuple[str, str] | None` — `(subject, text)`, 기록 없으면 `None`
  - `class Quota(Exception)`
  - `send(client: httpx.Client, to: str, subject: str, text: str, unsub: str, key: str) -> None` — 429 면 `Quota`, 그 밖의 오류면 `httpx.HTTPStatusError`

- [ ] **Step 1: Write the failing test**

`collector/test_digest.py`:

```python
"""digest.py 의 주 경계·지역 풀이·문구·보내기. 네트워크·DB 없이 돈다."""
import json
from datetime import datetime, timezone

import httpx

import digest
from digest import KST

# AREA_SQL 한 줄: code, office, sd_name, wiw_name, district, name (member_area + member.district 실측 모양)
ROWS = [
    ("M1", "국회의원", "전북특별자치도", "김제시", "전북 군산시김제시부안군을", "가의원"),
    ("M2", "국회의원", "대구광역시", "달서구", "대구 달서구갑", "나의원"),
    ("M3", "국회의원", "대구광역시", "서구", "대구 서구", "다의원"),
    ("H1", "구시군의장", "대구광역시", "서구", "서구", "라구청장"),
    ("H2", "구시군의장", "대구광역시", "달서구", "달서구", "마구청장"),
    ("G1", "시도지사", "대구광역시", None, "대구광역시", "바시장"),
    ("E1", "교육감", "대구광역시", None, "대구광역시", "사교육감"),
    ("P1", "국회의원", "전국", None, "비례대표", "아의원"),
    ("G2", "시도지사", "전남광주통합특별시", None, "전남광주통합특별시", "자지사"),
    ("M4", "국회의원", "광주광역시", "북구", "광주 북구갑", "차의원"),
    ("H3", "구시군의장", "광주광역시", "북구", "북구", "카구청장"),
]


def codes(sd, wiw):
    return [c for c, _, _ in digest.resolve(ROWS, sd, wiw)]


def test_week():
    # 월요일 아침(KST)에 도는 실행은 그 월요일 주이고, 담는 기간은 지난주 월 00:00 ~ 이번 주 월 00:00.
    mon = datetime(2026, 10, 12, 9, 10, tzinfo=KST)
    assert digest.week_of(mon).isoformat() == "2026-10-12"
    start, end = digest.window(digest.week_of(mon))
    assert (start.isoformat(), end.isoformat()) == ("2026-10-05T00:00:00+09:00", "2026-10-12T00:00:00+09:00")
    # 일요일 밤은 아직 지난주다.
    assert digest.week_of(datetime(2026, 10, 11, 23, 59, tzinfo=KST)).isoformat() == "2026-10-05"
    # 러너는 UTC 다. UTC 일요일 15:30 은 KST 월요일 00:30 — 새 주다.
    assert digest.week_of(datetime(2026, 10, 11, 15, 30, tzinfo=timezone.utc)).isoformat() == "2026-10-12"


def test_resolve():
    # '서구' 는 달서구에 붙지 않는다. 구청장은 시군구가 같아야, 시도지사·교육감은 시도 전체.
    assert codes("대구광역시", "서구") == ["M3", "H1", "G1", "E1"]
    # 한 지역구가 여러 시를 묶어도(군산시김제시부안군을) 군산시 주민이 자기 의원을 찾는다.
    assert codes("전북특별자치도", "군산시") == ["M1"]
    # 광주는 시도지사만 통합 이름으로 넘어왔다. 광주 북구 주민에게 통합 시도지사가 나와야 한다.
    assert codes("전남광주통합특별시", "북구") == ["M4", "H3", "G2"]
    # 시군구를 안 고르면 시도 전체. 비례대표('전국')는 어디에도 없다.
    assert codes("대구광역시", "") == ["M2", "M3", "H1", "H2", "G1", "E1"]
    assert codes("전국", "") == []


START, END = digest.window(digest.week_of(datetime(2026, 10, 12, 9, tzinfo=KST)))
PEOPLE = [("M3", "다의원", "국회의원"), ("H1", "라구청장", "구시군의장"), ("G1", "바시장", "시도지사")]
CHANGES = [
    ("M3", "bill", {"bill_id": "PRC_A1B2", "name": "도로교통법 일부개정법률안", "proposed_at": "2026-10-07"}),
    ("M3", "vote", {"result": "찬성", "n": 10}),
    ("M3", "vote", {"result": "불참", "n": 2}),
    ("M3", "attendance", {"age": 22, "session_no": 430, "as_of": "2026-10-08", "present": 120, "days": 125}),
    ("H1", "pledge", {"pledge_id": 7, "title": "서구 공영주차장 확충", "order_no": 1, "status": "진행", "decided_by": "auto"}),
]
# 평가로 읽히는 말. 기록만 옮기므로 문구 틀에서 하나도 나오면 안 된다.
JUDGY = ["우수", "저조", "성실", "칭찬", "비판", "최고", "최악", "잘했", "못했", "!"]


def test_render():
    subject, text = digest.render("대구광역시 서구", PEOPLE, CHANGES, START, END, "TOKEN")
    assert subject == "[누렁소검은소] 대구광역시 서구 주간 기록 10.05~10.11"
    assert "2026-10-05 ~ 2026-10-11 에 새로 수집된 공개 기록" in text
    assert "■ 다의원 (국회의원)  https://nureongso.joon.is-a.dev/m/M3" in text
    assert "- 대표발의 도로교통법 일부개정법률안 (2026-10-07)\n  https://nureongso.joon.is-a.dev/bill/PRC_A1B2" in text
    assert "- 본회의 표결 12건: 찬성 10 · 반대 0 · 기권 0 · 불참 2" in text
    assert "- 본회의 출결 제22대 제430회까지 누적: 출석 120 / 회의일수 125" in text
    assert "- 공약 판정 「서구 공영주차장 확충」 진행 (자동 판정)" in text
    # 국회의원이 위, 기록이 없는 사람(바시장)은 싣지 않는다.
    assert text.index("다의원") < text.index("라구청장") and "바시장" not in text
    assert "https://nureongso.joon.is-a.dev/rules" in text
    assert "https://nureongso.joon.is-a.dev/subscription?do=stop&t=TOKEN" in text
    for w in JUDGY:
        assert w not in subject + text, w


def test_render_caps_and_empty():
    # 재적재로 한 주에 수백 건이 '새로' 잡혀도 한 사람·한 종류는 10줄까지만.
    many = [("M3", "bill", {"bill_id": f"B{i:02}", "name": f"법안{i:02}", "proposed_at": None}) for i in range(12)]
    _, text = digest.render("대구광역시 서구", PEOPLE, many, START, END, "T")
    assert text.count("- 대표발의 법안") == 10 and "- 대표발의 외 2건" in text
    assert "(None)" not in text  # 발의일이 비면 괄호를 달지 않는다
    # 기록 없는 주는 보내지 않는다.
    assert digest.render("대구광역시 서구", PEOPLE, [], START, END, "T") is None


def test_send():
    got = []

    def ok(req):
        got.append(req)
        return httpx.Response(200, json={"id": "x"})

    with httpx.Client(transport=httpx.MockTransport(ok)) as c:
        digest.send(c, "a@example.com", "제목", "본문", "https://s/api/subscription?do=stop&t=T", "digest-2026-10-12-1")
    body = json.loads(got[0].content)
    assert body["to"] == ["a@example.com"] and body["subject"] == "제목" and body["text"] == "본문"
    # 메일 앱의 '구독 해지' 단추가 한 번에 해지하게(RFC 8058)
    assert body["headers"] == {"List-Unsubscribe": "<https://s/api/subscription?do=stop&t=T>",
                               "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    # 타임아웃 뒤 다시 보내도 같은 메일이 두 번 가지 않게(24시간)
    assert got[0].headers["Idempotency-Key"] == "digest-2026-10-12-1"

    full = httpx.MockTransport(lambda req: httpx.Response(429, json={"name": "daily_quota_exceeded"}))
    with httpx.Client(transport=full) as c:
        try:
            digest.send(c, "a@example.com", "s", "t", "u", "k")
        except digest.Quota:
            pass
        else:
            raise AssertionError("하루 한도(429)에서 멈춰야 한다")
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('test_digest');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]"
```
Expected: FAIL — `ModuleNotFoundError: No module named 'digest'`

- [ ] **Step 3: Write minimal implementation**

`collector/digest.py`:

```python
#!/usr/bin/env python3
"""내 지역 주간 기록 메일.

/my 에서 시도·시군구를 고르고 메일 주소를 넣은 사람에게, 지난주(월~일, KST)에 **새로 수집된**
그 지역 현직의 공개 기록을 보낸다 — 대표발의 법안, 본회의 표결(결과별 건수), 본회의 출결 누적,
공약 판정. '새로' 는 사건 날짜가 아니라 수집된 때다(bill·vote·attendance.created_at,
pledge_status.updated_at). 국회 API 가 며칠 늦게 주는 기록도 빠지지 않고, 주와 주가 겹치지 않는다.

- 한 사람에게 한 주 한 통: digest_log (구독자, 주) 기본키. 매일 돌려도 된다(digest.yml).
- 기록이 없는 주는 보내지 않는다(digest_log 에 sent=false 로만 남는다).
- 메일 한도(Resend 429)에 걸리면 깨끗이 멈춘다. 남은 사람은 다음 날 실행이 잇는다.
- 문구는 기록을 옮기기만 한다. 평가하는 말을 넣지 않는다(test_digest 가 막는다).

    python digest.py                              # 이번 주 메일을 보낸다
    python digest.py --preview 대구광역시 서구      # 다음 월요일 메일(지금까지 모인 것)을 찍기만 한다

환경변수: DATABASE_URL, RESEND_API_KEY, MAIL_FROM (--preview 는 DATABASE_URL 만)
"""
from __future__ import annotations

import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

KST = ZoneInfo("Asia/Seoul")
SITE = "https://nureongso.joon.is-a.dev"
FROM = os.getenv("MAIL_FROM")
RESEND = "https://api.resend.com/emails"
OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"]  # /my 와 같은 순서
VOTE_ORDER = ["찬성", "반대", "기권", "불참"]
DECIDED_BY = {"auto": "자동 판정", "reviewer": "검수"}
# 한 사람·한 종류에 이만큼만 적고 나머지는 '외 N건'. 재적재로 수백 건이 한꺼번에 '새로' 잡혀도 메일이 터지지 않게.
CAP = 10


def week_of(now: datetime) -> date:
    """now 가 속한 주의 월요일(KST). 이 주에 보내는 메일의 열쇠(digest_log.week)다."""
    d = now.astimezone(KST).date()
    return d - timedelta(days=d.weekday())


def window(week: date) -> tuple[datetime, datetime]:
    """week 에 보내는 메일이 담는 기간: 지난주 월 00:00 ~ 이번 주 월 00:00 (KST, 끝은 미포함)."""
    end = datetime.combine(week, datetime.min.time(), KST)
    return end - timedelta(days=7), end


# 아래 셋은 web/src/lib/area.ts 의 sido 와 web/src/app/my/page.tsx 의 picked·inDistrict 와 같은 규칙이다.
# 한쪽을 고치면 다른 쪽도(party_line / partyLine 처럼).
SD_MERGED = {"광주광역시": "전남광주통합특별시", "전라남도": "전남광주통합특별시"}


def sido(v: str | None) -> str:
    return SD_MERGED.get(v, v) if v else ""


def in_district(district: str, wiw: str) -> bool:
    """'전북 군산시김제시부안군을' 에 '김제시' 가 있나. 시군구 이름이 시작하는 자리에서만 센다
    — 그냥 포함이면 '서구' 가 달서구·강서구에, '양주시' 가 남양주시에 붙는다."""
    i = district.find(wiw)
    while i >= 0:
        if i == 0 or district[i - 1] in " 시군구":
            return True
        i = district.find(wiw, i + 1)
    return False


def resolve(rows, sd: str, wiw: str) -> list[tuple[str, str, str]]:
    """그 지역의 현직 (code, name, office). rows 는 (code, office, sd_name, wiw_name, district, name)."""
    out = []
    for code, office, sd_name, wiw_name, district, name in rows:
        if not sd_name or sd_name == "전국" or sido(sd_name) != sd:
            continue
        # 구시군의장은 시군구가 곧 관할, 국회의원은 지역구 이름 경계에서 잇는다. 시도지사·교육감은 시도 전체.
        if wiw and office == "구시군의장" and wiw_name != wiw:
            continue
        if wiw and office == "국회의원" and not in_district(district or "", wiw):
            continue
        out.append((code, name, office))
    rank = {o: i for i, o in enumerate(OFFICE_ORDER)}
    return sorted(out, key=lambda p: (rank.get(p[2], len(rank)), p[1]))


def render(area: str, people, changes, start: datetime, end: datetime, token: str) -> tuple[str, str] | None:
    """(제목, 본문). 기록이 하나도 없으면 None — 보내지 않는다."""
    by: dict = defaultdict(lambda: defaultdict(list))
    for code, kind, data in changes:
        by[code][kind].append(data)
    blocks = []
    for code, name, office in people:
        k = by.get(code)
        if not k:
            continue
        lines = []
        bills = sorted(k["bill"], key=lambda b: (b["proposed_at"] or "", b["bill_id"]))
        for b in bills[:CAP]:
            when = f" ({b['proposed_at']})" if b["proposed_at"] else ""
            lines.append(f"- 대표발의 {b['name']}{when}\n  {SITE}/bill/{b['bill_id']}")
        if len(bills) > CAP:
            lines.append(f"- 대표발의 외 {len(bills) - CAP}건")
        if k["vote"]:
            n = {v["result"]: v["n"] for v in k["vote"]}
            order = VOTE_ORDER + sorted(set(n) - set(VOTE_ORDER))
            lines.append(f"- 본회의 표결 {sum(n.values())}건: " + " · ".join(f"{r} {n.get(r, 0)}" for r in order))
        for a in k["attendance"]:
            lines.append(f"- 본회의 출결 제{a['age']}대 제{a['session_no']}회까지 누적: "
                         f"출석 {a['present']} / 회의일수 {a['days']}")
        pledges = sorted(k["pledge"], key=lambda p: (p["order_no"] or 0, p["pledge_id"]))
        for p in pledges[:CAP]:
            who = DECIDED_BY.get(p["decided_by"], p["decided_by"])
            lines.append(f"- 공약 판정 「{p['title']}」 {p['status']} ({who})")
        if len(pledges) > CAP:
            lines.append(f"- 공약 판정 외 {len(pledges) - CAP}건")
        blocks.append(f"■ {name} ({office})  {SITE}/m/{code}\n" + "\n".join(lines))
    if not blocks:
        return None
    last = end - timedelta(days=1)
    subject = f"[누렁소검은소] {area} 주간 기록 {start:%m.%d}~{last:%m.%d}"
    text = "\n\n".join([
        f"{area} — {start:%Y-%m-%d} ~ {last:%Y-%m-%d} 에 새로 수집된 공개 기록입니다.",
        *blocks,
        f"기관이 공개한 기록을 옮긴 것이며 평가를 담지 않습니다. 세는 방법: {SITE}/rules",
        f"구독 해지: {SITE}/subscription?do=stop&t={token}",
    ])
    return subject, text


class Quota(Exception):
    """메일 서비스 한도(429: 초당·하루·달). 그날은 멈추고 다음 실행에 맡긴다 — 재시도하지 않는다."""


def send(client: httpx.Client, to: str, subject: str, text: str, unsub: str, key: str) -> None:
    r = client.post(RESEND, headers={"Idempotency-Key": key}, json={
        "from": FROM, "to": [to], "subject": subject, "text": text,
        # 메일 앱의 '구독 해지' 단추가 바로 해지하게 한다(RFC 8058, POST). 본문 링크는 확인 화면을 거친다.
        "headers": {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
    })
    if r.status_code == 429:
        raise Quota(r.text[:200])
    r.raise_for_status()
```

같은 규칙을 가리키는 주석 둘.

`web/src/app/my/page.tsx` 의 `function inDistrict` 바로 위 주석을 바꾼다.

old:
```tsx
/** '서울 중구성동구갑' 에 '성동구' 가 있나. 시군구 이름이 시작하는 자리에서만 센다. */
```
new:
```tsx
/** '서울 중구성동구갑' 에 '성동구' 가 있나. 시군구 이름이 시작하는 자리에서만 센다.
 *  collector/digest.py 의 in_district·resolve 가 같은 규칙이다 — 한쪽을 고치면 다른 쪽도. */
```

`web/src/lib/area.ts` 의 `regionsOf` 주석 첫 줄을 바꾼다.

old:
```ts
/** 시도 → 시군구 목록(가나다순). /my 고르기와 구독 신청 검사(api/subscription)가 같은 목록을 쓴다.
```
new:
```ts
/** 시도 → 시군구 목록(가나다순). /my 고르기와 구독 신청 검사(api/subscription)가 같은 목록을 쓴다.
 *  sido 는 collector/digest.py 의 sido 와 같은 표다 — 한쪽을 고치면 다른 쪽도.
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('test_digest');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]" && echo PASS
cd ../web && npm run lint
```
Expected: `PASS`, 린트 오류 0

- [ ] **Step 5: Commit**

```bash
git add collector/digest.py collector/test_digest.py web/src/app/my/page.tsx web/src/lib/area.ts
git commit -m "$(cat <<'EOF'
주간 기록 메일의 주 계산·지역 풀이·문구를 만든다

한 주는 KST 월요일로 세고, 메일은 지난주 월 00:00~이번 주 월 00:00 에 수집된 기록을
담는다. 러너가 UTC 라 일요일 15시(UTC)가 이미 새 주인 것을 테스트에 박아 둔다.

지역 → 사람은 /my 와 같은 규칙을 옮긴다(party_line/partyLine 처럼 서로를 가리키는 주석).
'서구' 가 달서구에, 광주 주민이 통합 시도지사를 놓치는 일, 군산시김제시부안군을 같은
묶음 지역구를 실측 모양 그대로 확인한다.

문구는 기록 한 줄과 사이트 링크뿐이고, 평가로 읽히는 말이 나오면 테스트가 막는다.
한 사람·한 종류는 10줄까지 — 재적재로 수백 건이 '새로' 잡혀도 메일이 터지지 않게.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 매일 이어서 보내는 실행과 워크플로

**Files:**
- Modify: `collector/digest.py` (import 블록, 파일 끝에 덧붙임)
- Create: `.github/workflows/digest.yml`
- Modify: `collector/.env.example:29` 앞
- Modify: `.claude/rules/scheduler.md:14` 뒤, `:27` 뒤
- Modify: `CLAUDE.md:13`, `:28`, `:35` 뒤
- Modify: `README.md:10`, `:41` 뒤, `:75` 뒤

**Interfaces:**
- Consumes: Task 1 `digest_log`, Task 2 `digest_due(p_week)`·`digest_changes(p_codes, p_from, p_to)`, Task 5 `week_of`·`window`·`resolve`·`render`·`send`·`Quota`·`SITE`·`FROM`
- Produces: `python digest.py` (보내기), `python digest.py --preview <시도> [<시군구>]` (찍기만), `AREA_SQL: str`, `changes_of(cur, people, start, end) -> list[tuple]`, 워크플로 `digest.yml`(동시 실행 그룹 `digest`, 시크릿 `DATABASE_URL`·`RESEND_API_KEY`·`MAIL_FROM`)

- [ ] **Step 1: Write the failing test**

실제 DB 를 읽기만 하는 미리보기로 확인한다(쓰지도 보내지도 않는다).

```bash
cd collector && dotenvx run -q -- .venv/bin/python digest.py --preview 대구광역시 서구
```

- [ ] **Step 2: Run test to verify it fails**

Expected: 아무것도 찍히지 않고 끝난다(`digest.py` 에 실행 본체가 아직 없다). `echo $?` 는 0 — 실패의 표시는 '사람 목록 줄이 없다' 는 것이다.

- [ ] **Step 3: Write minimal implementation**

`collector/digest.py` 의 import 를 바꾼다.

old:
```python
import os
from collections import defaultdict
```
new:
```python
import argparse
import os
import sys
import time
from collections import defaultdict
```

old:
```python
import httpx
```
new:
```python
import httpx
import psycopg
```

파일 끝에 덧붙인다.

```python


AREA_SQL = """
select a.member_code, a.office, a.sd_name, a.wiw_name, m.district, m.name
from member_area a join member m on m.code = a.member_code
"""


def changes_of(cur, people, start: datetime, end: datetime) -> list[tuple]:
    if not people:
        return []
    cur.execute("select member_code, kind, data from digest_changes(%s, %s, %s)",
                ([c for c, _, _ in people], start, end))
    return cur.fetchall()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--preview", nargs="+", metavar="지역",
                   help="'시도 [시군구]' 의 다음 월요일 메일(지금까지 모인 것)을 찍기만 한다")
    a = p.parse_args()
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다. .env 를 확인하세요.")
    week = week_of(datetime.now(KST))

    if a.preview:
        sd, wiw = a.preview[0], " ".join(a.preview[1:])
        start, end = window(week + timedelta(days=7))
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(AREA_SQL)
            people = resolve(cur.fetchall(), sd, wiw)
            mail = render(" ".join(filter(None, [sd, wiw])), people,
                          changes_of(cur, people, start, end), start, end, "TOKEN")
        print(f"{len(people)}명: {', '.join(f'{n}({o})' for _, n, o in people)}")
        print(f"Subject: {mail[0]}\n\n{mail[1]}" if mail else "이 기간 새 기록 없음 — 보내지 않는다")
        return

    key = os.environ.get("RESEND_API_KEY")
    if not (key and FROM):
        sys.exit("RESEND_API_KEY, MAIL_FROM 이 없습니다. .env 를 확인하세요.")
    start, end = window(week)
    sent = empty = failed = 0
    with psycopg.connect(dsn) as conn, \
            httpx.Client(timeout=30, headers={"Authorization": f"Bearer {key}"}) as client:
        with conn.cursor() as cur:
            # 확인하지 않은 주소는 7일 뒤 지운다. 확인 링크도 그때 끊긴다(subscription_confirm).
            cur.execute("delete from subscriber where confirmed_at is null"
                        " and coalesce(confirm_sent_at, created_at) < now() - interval '7 days'")
            cur.execute(AREA_SQL)
            areas = cur.fetchall()
            cur.execute("select id, email, sd_name, wiw_name, token from digest_due(%s)", (week,))
            due = cur.fetchall()
        conn.commit()

        made: dict[tuple[str, str], tuple] = {}  # 같은 지역 구독자는 한 번만 센다
        for sid, email, sd, wiw, token in due:
            if (sd, wiw) not in made:
                people = resolve(areas, sd, wiw)
                with conn.cursor() as cur:
                    made[(sd, wiw)] = (people, changes_of(cur, people, start, end))
            people, changes = made[(sd, wiw)]
            mail = render(" ".join(filter(None, [sd, wiw])), people, changes, start, end, str(token))
            with conn.cursor() as cur:
                # 먼저 '처리함' 을 적고 보낸다. 겹친 실행이 있어도 한쪽만 적힌다(기본키).
                cur.execute("insert into digest_log (subscriber_id, week, sent) values (%s, %s, %s)"
                            " on conflict do nothing returning 1", (sid, week, mail is not None))
                claimed = cur.fetchone()
            conn.commit()
            if not claimed:
                continue
            if not mail:
                empty += 1
                continue
            try:
                send(client, email, *mail, f"{SITE}/api/subscription?do=stop&t={token}", f"digest-{week}-{sid}")
                sent += 1
            except (Quota, httpx.HTTPError) as e:
                # 못 보냈으면 적은 것을 지워 다음 실행이 다시 집게 한다.
                with conn.cursor() as cur:
                    cur.execute("delete from digest_log where subscriber_id = %s and week = %s", (sid, week))
                conn.commit()
                if isinstance(e, Quota):
                    print(f"[digest] 메일 한도: {e} — 남은 사람은 다음 실행이 잇는다", file=sys.stderr)
                    break
                print(f"[digest] ! {sid}: {e}", file=sys.stderr)
                failed += 1
            time.sleep(0.2)  # Resend 기본 한도 초당 10건
    print(f"[digest] {week} 주 · 보냄 {sent} · 기록 없음 {empty} · 실패 {failed} · 대상 {len(due)}",
          file=sys.stderr)
    # 성공한 것은 이미 적혔다. 그래도 초록불로 끝내면 못 받은 사람을 아무도 모른다.
    if failed:
        sys.exit(f"{failed}명에게 보내지 못했습니다. 다음 실행이 다시 시도합니다.")


if __name__ == "__main__":
    main()
```

`.github/workflows/digest.yml`:

```yaml
name: 주간 기록 메일

# /my 에서 구독한 사람에게 지난주(월~일, KST)에 새로 수집된 그 지역 현직의 공개 기록을 보낸다
# (collector/digest.py). 매일 돌지만 한 사람에게 한 주 한 통이다 — digest_log (구독자, 주) 기본키가
# 막아서 다시 돌려도 이미 처리한 사람은 건너뛴다. 기록이 없는 주는 보내지 않는다.
#
# 매일 도는 이유: Resend 무료 한도가 하루 100통이다. 월요일에 다 못 보내면 429 에서 깨끗이 멈추고
# 다음 날 남은 사람부터 잇는다. 한도는 UTC 자정(09:00 KST)에 풀리므로 그 직후에 돈다.
# 담는 기간은 수집 시각 기준이라 ingest·nec·evidence 가 언제 돌든 겹치거나 빠지지 않는다.
on:
  schedule:
    - cron: "10 0 * * *" # 매일 09:10 KST (UTC+9)
  workflow_dispatch:

concurrency:
  group: digest
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: collector/requirements.txt

      - run: pip install -r requirements.txt
        working-directory: collector

      - name: 주간 기록 메일
        working-directory: collector
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
        run: python digest.py

      - name: 결과 요약
        if: always()
        working-directory: collector
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          python - <<'PY' >> "$GITHUB_STEP_SUMMARY"
          import os, psycopg
          with psycopg.connect(os.environ["DATABASE_URL"]) as c, c.cursor() as cur:
              cur.execute("""select count(*) filter (where confirmed_at is not null),
                                    count(*) filter (where confirmed_at is null) from subscriber""")
              ok, wait = cur.fetchone()
              print(f"구독 {ok:,}명 · 확인 대기 {wait:,}명")
              cur.execute("""select week, count(*) filter (where sent), count(*) filter (where not sent)
                             from digest_log group by week order by week desc limit 1""")
              row = cur.fetchone()
              if row:
                  print(f"\n{row[0]} 주: 보냄 {row[1]:,} · 기록 없어 안 보냄 {row[2]:,}")
              # 몇 주째 0 이면 created_at 이 안 채워지는 것이다(수집기가 그 칸을 덮어쓰는지 본다).
              cur.execute("""select (select count(*) from bill where created_at > now() - interval '7 days'),
                                    (select count(*) from pledge_status where updated_at > now() - interval '7 days')""")
              b, s = cur.fetchone()
              print(f"\n지난 7일 새로 들어온 법안 {b:,}건 · 바뀐 공약 판정 {s:,}건")
          PY
```

`collector/.env.example` — 29행 `# --- 아래는 선택. LLM 을 바꿀 때만 ---` 바로 위에 덧붙인다.

```bash
# 주간 기록 메일(digest.py). web/.env.local 의 RESEND_API_KEY·MAIL_FROM 과 같은 값.
# Resend(https://resend.com) API 키와, Resend 에서 확인한 도메인의 보내는 사람.
RESEND_API_KEY=
MAIL_FROM=

```

`.claude/rules/scheduler.md` — 14행(`race.yml` 줄) 아래에 표 한 줄을 더한다.

```markdown
| `digest.yml` | 매일 09:10 | `digest` | `digest.py` — 구독자에게 지난주(월~일) 새로 수집된 기록 메일. 한 사람에게 한 주 한 통 |
```

27행(`- 새 단계를 넣으면 …`) 아래에 덧붙인다.

```markdown
- `digest.yml` 은 매일 돌지만 한 사람에게 한 주 한 통이다(`digest_log` 기본키, 보내기 전에 적고 실패하면 지운다).
  09:10 인 이유: Resend 하루 한도(무료 100통)가 UTC 자정에 풀린다. 한도에 걸리면 멈추고 다음 날 남은 사람부터 잇는다.
  담는 기간은 **수집 시각** 기준 지난주 월 00:00~이번 주 월 00:00(KST)이라 다른 워크플로 시각과 상관없이 겹치거나 빠지지 않는다.
  내용 확인은 `python digest.py --preview 시도 [시군구]`(쓰지도 보내지도 않는다).
```

`CLAUDE.md` 수정 셋.

13행:
old:
```
.github/     정기 수집 워크플로 4개(ingest·nec·evidence·race), 오류 제보 이슈 양식
```
new:
```
.github/     정기 워크플로 5개(ingest·nec·evidence·race·digest), 오류 제보 이슈 양식
```

28행:
old:
```
  매일 18:00 `race.yml`(후보 공약 비교 재생성, 다 돌면 지운다)(KST).
```
new:
```
  매일 18:00 `race.yml`(후보 공약 비교 재생성, 다 돌면 지운다), 매일 09:10 `digest.yml`(구독자 주간 기록 메일)(KST).
```

35행(`node web/src/lib/force.check.mjs …`) 아래에 두 줄:
```
node web/src/lib/subscription.check.mjs   # 구독 신청 입력·지역 목록
cd collector && dotenvx run -q -- .venv/bin/python -c "import os,psycopg; c=psycopg.connect(os.environ['DATABASE_URL']); c.execute(open('../supabase/subscription.check.sql').read()); print('ok')"   # 구독 표·함수, begin…rollback
```

`README.md` 수정 셋.

10행 끝 `· Gemini(공약 추출·근거 대조)` 를 `· Gemini(공약 추출·근거 대조) · Resend(주간 기록 메일)` 로 바꾼다.

41행(`/my` 내 지역 대표 줄) 아래에 덧붙인다.
```markdown
- 주간 기록 메일 — `/my` 에서 지역을 고른 뒤 메일 주소를 넣으면, 매주 월요일 지난주에 새로 수집된 그 지역 현직의
  대표발의 법안·본회의 표결 건수·출결 누적·공약 판정(자동/검수)을 텍스트로 보낸다. 기록이 없는 주는 보내지 않는다.
  확인 메일을 눌러야 시작하고 메일마다 해지 링크가 있다. 저장하는 것은 메일 주소·지역·신청/확인 시각뿐이다
```

75행(`race.yml   매일 — …`) 아래에 덧붙인다.
```
             digest.yml 매일 — 구독자 주간 기록 메일(한 사람에게 한 주 한 통, 하루 한도에서 멈추면 다음 날 잇는다)
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd collector && dotenvx run -q -- .venv/bin/python digest.py --preview 대구광역시 서구
```
Expected: 첫 줄 `N명: 김…(국회의원), …(구시군의장), …(시도지사), …(교육감)` — `/my?sd=대구광역시&wiw=서구` 화면의 사람과 같은 목록. 다음 줄은 `Subject: [누렁소검은소] 대구광역시 서구 주간 기록 …` 와 본문, 또는 Task 2 를 적용한 지 하루가 안 됐으면 `이 기간 새 기록 없음 — 보내지 않는다`. 본문의 문구가 기록 한 줄 + 링크뿐인지 눈으로 본다.

수집기 테스트 전체:
```bash
cd collector && for f in test_*.py; do dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('${f%.py}');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]" || echo "FAIL $f"; done
```
Expected: `FAIL` 줄 없음

- [ ] **Step 5: Commit**

```bash
git add collector/digest.py collector/.env.example .github/workflows/digest.yml .claude/rules/scheduler.md CLAUDE.md README.md
git commit -m "$(cat <<'EOF'
주간 기록 메일을 매일 이어서 보내는 워크플로를 단다

digest.yml 이 매일 09:10 KST 에 digest.py 를 돌린다. 한 사람에게 한 주 한 통은 digest_log
기본키가 지킨다 — 보내기 전에 적고 실패하면 지워서 다시 돌려도 두 번 가지 않는다. 타임아웃
뒤 실제로는 나간 경우는 Idempotency-Key 가 막는다.

매일 도는 이유는 Resend 무료 한도가 하루 100통이라서다. 월요일에 다 못 보내면 429 에서
멈추고 다음 날 남은 사람부터 잇는다. 한도가 UTC 자정에 풀려 그 직후(09:10 KST)에 돈다.
기록이 없는 주는 보내지 않고, 확인하지 않은 주소는 7일 뒤 지운다.

--preview 는 DB 를 읽기만 해서 다음 월요일 메일을 미리 본다.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

**사용자가 직접(푸시 뒤):** GitHub 저장소 Secrets 에 `RESEND_API_KEY`·`MAIL_FROM` 추가 → `gh workflow run digest.yml` → Actions 요약에 `구독 …명 · 확인 대기 …명` 과 `지난 7일 새로 들어온 법안 …건` 이 찍히는지 본다. 첫 실제 발송은 확인을 마친 다음 월요일이다(`digest_due` 는 그 주가 시작되기 전에 확인한 사람만 집는다).

---

## 운영 적용 순서

1. Resend 가입 → 보내는 도메인 확인(아래 열린 질문) → API 키 발급.
2. Task 1·2 의 SQL 덩어리를 운영 DB 에 적용(각 Task Step 4, 수집 워크플로가 도는 시간 피함).
3. Vercel 환경변수 `SUPABASE_SERVICE_ROLE_KEY`·`RESEND_API_KEY`·`MAIL_FROM`, GitHub Secrets `RESEND_API_KEY`·`MAIL_FROM`.
4. `master` 푸시(사용자) → Vercel 배포 → Task 4 의 실제 메일 확인 → `digest.yml` 수동 실행 한 번.

## 열린 질문 (사용자 결정)

- **보내는 도메인:** `nureongso.joon.is-a.dev` 를 Resend 에서 확인하려면 is-a.dev 저장소에 PR 로 `send.nureongso.joon`(MX·SPF TXT)·`resend._domainkey.nureongso.joon`(DKIM TXT) 레코드를 올려야 한다(is-a.dev 는 중첩 서브도메인·TXT·MX 를 허용한다). 공유 무료 도메인이라 평판이 약할 수 있다 — 따로 도메인을 살지.
- **한도:** Resend 무료로 하루 100통·월 3,000통(구독자 주 ~700명 상한). 넘으면 Pro $20/월 또는 SES.
- **발송 요일·시각:** 월요일 09:10 KST 첫 실행(한도 초기화 직후). 다른 요일을 원하면 `week_of` 의 기준 요일만 바꾼다.

---
paths:
  - "**/.env*"
  - "supabase/**"
  - "web/vercel.json"
  - "web/next.config.ts"
---

# 인프라·시크릿·장애

## 계정·자원

| 무엇 | 어디 | 비고 |
|---|---|---|
| DB | Supabase 무료 | 500MB 한도. `evidence.yml` 요약에 현재 용량이 찍힌다 |
| 웹 | Vercel, 리전 `icn1` | 환경변수는 Vercel 에(서버 전용 `SUPABASE_SERVICE_ROLE_KEY` `RESEND_API_KEY` `MAIL_FROM` 포함 — 셋 다 있어야 구독 폼이 켜진다). `NEXT_PUBLIC_SITE_URL` = https://nureongso.joon.is-a.dev. 무료 한도(이미지 변환 5천 · Fast Origin Transfer 10GB · 함수 CPU 4시간)를 2026-10 에 75~85% 까지 써서 CDN 캐시를 걸었다. 그래도 2026-10-16 Active CPU 가 4h 5m 로 넘쳤다 — 크롤러 prefetch, `web.md` |
| 수집 | GitHub Actions | 시크릿: `DATABASE_URL` `ASSEMBLY_API_KEY` `DATA_GO_KR_KEY` `LAW_OC` `GEMINI_API_KEY` `RESEND_API_KEY` `MAIL_FROM` |
| LLM | Gemini 무료 | 하루 한도는 키가 아니라 **구글 클라우드 프로젝트** 단위. 키를 쉼표로 여럿 넣으려면 프로젝트가 달라야 한다 |
| 메일 | Resend 무료 | 하루 100통·월 3,000통, 하루 한도는 UTC 자정(09:00 KST)에 풀린다. 확인 메일(web)과 주간 메일(`digest.yml`)이 같은 키. 보내는 도메인을 Resend 에서 확인해야 한다 |

## 시크릿

- `collector/.env` 는 dotenvx 암호문이라 커밋돼 있고, `web/.env.local` 도 같은 방식이다. 평문으로 쓰지 않는다.
  읽기 `dotenvx get KEY`, 쓰기 `dotenvx set KEY 값`. 새 파일은 `dotenvx encrypt -f 파일`.
- 개인키 `.env.keys` 는 OS 키체인·로컬에만 있다. 읽거나 커밋하지 않는다(`.claude/hooks/protect.sh` 가 막는다).
- anon 키는 공개값이다. 모든 테이블이 RLS 읽기 전용이고 쓰기 정책이 하나도 없다 — 쓰기 정책을 새로 만들지 않는다.
  구독 표(`subscriber`·`digest_log`)는 읽기 정책도 없고 anon 권한을 거뒀다. 쓰기는 `web/src/app/api/subscription/route.ts`
  가 service_role 키로 `subscription_request`·`subscription_confirm`·`subscription_stop` 만 부른다. 그 키는 그 파일 밖에서 읽지 않는다.
- `DATABASE_URL` 은 Session pooler URI. 비밀번호에 `@` 등이 있으면 키워드 형식(`host=… password='…'`)을 쓴다.

## 스키마 변경

마이그레이션 도구가 없다. `supabase/schema.sql` 이 유일한 원본이다.
1. `schema.sql` 을 고친다(되살릴 수 있게 지운 것은 주석으로 커밋·이유를 남긴다).
2. 바뀐 문만 SQL Editor 에서 실행한다. 파일 전체를 다시 돌리지 않는다.
3. `drop`·`truncate` 는 사용자 확인 뒤에만. 운영 DB 하나뿐이고 스테이징이 없다.
4. 뷰는 `with (security_invoker = true)` 로 만든다. Supabase 기본 권한이 anon 에 뷰 INSERT·UPDATE·DELETE 를
   주고 단순 뷰는 저절로 쓰기가 돼서, 소유자 권한 뷰는 RLS 를 건너 anon 이 원본 표를 고칠 수 있다
   (2026-10-15 `pledge_doc_link`). 표의 칸 일부만 열 때는 칸 단위 grant 와 읽기 정책으로.
5. `ingest_run` 은 로그가 아니라 **상태**다. 용량을 줄이려고 오래된 줄을 지우지 않는다.
   - 판정이 읽는다: `match:`·`ordin:`·`bid:<사람>` 줄이 있어야 대조를 마친 것(`judge.py` JUDGED `checked`).
     지우면 그 사람 공약이 미착수·진행에서 '아직 대조하지 않음'(판단불가)으로 돌아가고 판정 이력이 대량으로 남는다.
   - 대조 이어받기(마지막 대조 뒤 새 기록만), 절차 R 가드(`rule:<판>@<커밋>`), 요약의 수집 노후 경고도 읽는다.
   - `source` 접두사는 스키마에 없는 약속이다. 새 단계를 만들 때 기존 접두사를 다른 뜻으로 쓰지 않는다.

## 장애 런북 — 사이트 목록·통계·인물 페이지가 응답하지 않을 때

2026-09-27 실제 사례: DB 쿼리 0건·잠금 0건인데 REST·인증이 멈췄다. 원인은 **Disk IO Budget 소진**으로
디스크가 5MB/s 로 묶인 것.
1. Supabase 대시보드 → Reports → Disk IO 잔량 확인.
2. `pg_stat_statements` 에서 `shared_blks_written`·`wal_bytes` 상위 쿼리를 본다.
3. 범인은 대개 같은 값을 다시 쓰는 수집이다. 확인할 것:
   - upsert 에 `where (...) is distinct from excluded(...)` 가 있는가(직접 SQL 쓰는 judge 포함).
   - 발의자 명단처럼 큰 표를 매일 통째로 다시 넣고 있지 않은가.
   - 요청마다 큰 표를 정렬하지 않는가 — 미리 머티리얼라이즈드 뷰로(`bid_notice_first`, `bid.py fetch` 끝에 refresh).
   - OFFSET 으로 끝까지 훑지 않는가 — 기본키 keyset.
4. 급하면 해당 워크플로를 Actions 에서 비활성화하고, 예산이 회복될 때까지 기다린다.
5. Supabase 로그 수집은 무료 1GB/월(조직 전체, 2027 부터 과금). 평소 하루 16MB 남짓 — Vercel 서버 렌더의
   REST 요청 약 6,500건(edge_logs)과 플랫폼 pgbouncer 상태 확인. 2026-09-26~27 장애 이틀에 3.2GB 가 쌓였고
   같은 날 로그 조회도 80GB(한도 100GB)를 썼다. 장애 중 로그·Reports 는 짧은 구간으로만 연다.

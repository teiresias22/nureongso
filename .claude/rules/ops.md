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
| 웹 | Vercel, 리전 `icn1` | 환경변수는 Vercel 에. `NEXT_PUBLIC_SITE_URL` 은 자체 도메인을 붙일 때만 |
| 수집 | GitHub Actions | 시크릿: `DATABASE_URL` `ASSEMBLY_API_KEY` `DATA_GO_KR_KEY` `LAW_OC` `GEMINI_API_KEY` |
| LLM | Gemini 무료 | 하루 한도는 키가 아니라 **구글 클라우드 프로젝트** 단위. 키를 쉼표로 여럿 넣으려면 프로젝트가 달라야 한다 |

## 시크릿

- `collector/.env` 는 dotenvx 암호문이라 커밋돼 있고, `web/.env.local` 도 같은 방식이다. 평문으로 쓰지 않는다.
  읽기 `dotenvx get KEY`, 쓰기 `dotenvx set KEY 값`. 새 파일은 `dotenvx encrypt -f 파일`.
- 개인키 `.env.keys` 는 OS 키체인·로컬에만 있다. 읽거나 커밋하지 않는다(`.claude/hooks/protect.sh` 가 막는다).
- anon 키는 공개값이다. 모든 테이블이 RLS 읽기 전용이고 쓰기 정책이 하나도 없다 — 쓰기 정책을 새로 만들지 않는다.
- `DATABASE_URL` 은 Session pooler URI. 비밀번호에 `@` 등이 있으면 키워드 형식(`host=… password='…'`)을 쓴다.

## 스키마 변경

마이그레이션 도구가 없다. `supabase/schema.sql` 이 유일한 원본이다.
1. `schema.sql` 을 고친다(되살릴 수 있게 지운 것은 주석으로 커밋·이유를 남긴다).
2. 바뀐 문만 SQL Editor 에서 실행한다. 파일 전체를 다시 돌리지 않는다.
3. `drop`·`truncate` 는 사용자 확인 뒤에만. 운영 DB 하나뿐이고 스테이징이 없다.

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

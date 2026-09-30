# 누렁소검은소

선출직(국회의원·시도지사·구시군의장·교육감)의 공약과 이행, 임기 중 공개 기록을 나란히 보여준다.
기관이 공개한 기록만 옮기고, 공약 이행은 공개된 규칙으로 판정한다. **의견·평점·댓글은 싣지 않는다.**
배경·집계 기준·출처·실측 함정의 원본은 `README.md`. 경로별 상세는 `.claude/rules/` 가 그 파일을 읽을 때 붙는다.

## 구조

```
collector/   Python 3.12 수집기 → Supabase(Postgres). 파일 하나가 출처 하나
supabase/    schema.sql 하나. 마이그레이션 도구 없음 — SQL Editor 에 붙여 실행
web/         Next.js 16 (App Router) + supabase-js, Vercel(icn1)
.github/     정기 수집 워크플로 3개(ingest·nec·evidence), 오류 제보 이슈 양식
```

## 환경·브랜치

- 브랜치는 `master` 하나. 커밋 메시지는 한국어 서술형 한 줄(`~한다`)에 본문으로 이유.
- 비밀값은 dotenvx 로 **제자리 암호화**돼 있다(`collector/.env` 는 암호문째 커밋, `web/.env.local`).
  실행은 항상 `dotenvx run -- …`, 값 변경은 `dotenvx set KEY 값`. 개인키 `.env.keys` 는 건드리지 않는다.
- 수집기 가상환경은 `collector/.venv`.

## 배포 요점

- web: Vercel, `web/` 가 루트. 배포 주소 https://nureongso-puce.vercel.app
- DB: Supabase 무료(500MB). 스키마 변경은 `schema.sql` 을 고치고 SQL Editor 에서 해당 문만 실행.
- 수집: GitHub Actions — 매일 04:00 `ingest.yml`, 화 04:30 `nec.yml`, 월 05:00 `evidence.yml`(KST).

## 테스트

```bash
cd collector && for f in test_*.py; do dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('${f%.py}');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]" || echo "FAIL $f"; done
cd web && npm run lint && npm run build
```

`python test_asset.py` 처럼 파일만 돌리면 `test_asset`·`test_extras`·`test_gwanbo` 는 **아무것도 실행하지 않고** 통과한다.

## 핵심 함정

- **같은 값을 다시 쓰지 않는다.** upsert 는 `where (...) is distinct from excluded(...)` 를 단다(`ingest.upsert`).
  2026-09-27 Disk IO Budget 소진으로 사이트가 멈췄다 — `.claude/rules/ops.md`.
- `ASSEMBLY_API_KEY` 없이 열린국회정보를 부르면 첫 5행만 반복하면서 총건수는 정상으로 준다.
- `ingest.yml`·`nec.yml` 은 같은 동시 실행 그룹이다. 수동 실행을 연달아 넣으면 앞의 대기 실행이 **취소된다**.
- `web/` 의 Next.js 는 학습 데이터와 다르다. 코드 전에 `web/node_modules/next/dist/docs/` 를 본다(`web/AGENTS.md`).
- PostgREST 는 1000행에서 **조용히** 자른다. 많이 받는 곳은 범위를 나누거나 keyset 으로 읽는다.
- 정치자금 기부내역·병역·납세·전과·외부 기관 이행 등급은 공개돼 있어도 싣지 않는다(README '싣지 않는 것').

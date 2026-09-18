# 누렁소검은소

국회의원이 **무슨 공약을 했고 얼마나 지켰는지**, **법안을 얼마나 발의하고 남의 법안에 서명했는지**를
유권자가 한눈에 볼 수 있게 하는 프로젝트. 선거 공보물만으로는 N선 의원의 지난 임기 성적표를 알 수 없다는
문제에서 출발했다.

## 지금 되는 것 (Phase 1)

- 현역 의원 300명 목록 — 정당·지역구 검색, 대표발의/공동발의 순 정렬
- 의원 상세 — 대표발의 건수, 공동발의 건수, 가결률, 본회의 표결 참여율, 찬반 분포, 법안 목록
- 법안 상세 — 대표발의자 / 공동발의자 전원, 본회의 표결 집계

출마 이력(Phase 2), 공약(Phase 3), 이행도 판정(Phase 4)은 화면 자리만 잡아둔 상태.

## 구조

```
collector/   Python 수집기 (열린국회정보 / 선관위 Open API → Supabase)
supabase/    schema.sql  (Supabase SQL Editor 에 붙여넣어 실행)
web/         Next.js (App Router) 프론트
```

## 시작하기

1. Supabase 프로젝트 생성 → SQL Editor 에 `supabase/schema.sql` 실행
2. `.env.example` 참고해 `collector/.env`, `web/.env.local` 작성
3. 수집

```bash
cd collector
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
set -a; source .env; set +a
.venv/bin/python ingest.py all --age 22
```

`members` → `bills` → `plenary` → `votes` 순으로 돈다. votes 는 의안 1건당 1회 호출이라
22대 기준 약 1,800회, 20~30분 걸린다. 중단해도 이미 받은 의안은 건너뛴다.

> **`ASSEMBLY_API_KEY` 는 필수다.** 키 없이 호출하면 서버가 `pIndex`/`pSize` 를 무시하고
> 매번 첫 5행만 돌려주면서 총건수는 정상값을 준다. 그대로 두면 같은 행을 수천 번 수집한다.
> 수집기는 키가 없으면 시작하지 않고, 페이지가 안 넘어가면 중단한다.

4. 웹

```bash
cd web && npm run dev
```

## 데이터 출처 (전부 무료)

| 데이터 | 서비스 |
|---|---|
| 현역 의원 인적사항 | 열린국회정보 `nwvrqwxyaytdsfvhu` |
| 역대 의원 인적사항 | 열린국회정보 `ALLNAMEMBER` |
| 발의법률안 + 공동발의자 | 열린국회정보 `nzmimeepazxkubdpn` |
| 본회의 처리 의안 | 열린국회정보 `ncocpgfiaoituanbr` |
| 본회의 표결 | 열린국회정보 `nojepdqqaweusdfbi` |
| 역대 출마·득표 (Phase 2) | 선관위 후보자/당선인/투개표 정보 (data.go.kr) |
| 공약 원문 (Phase 3) | 선관위 정책·공약마당 선거공보 PDF |

공동발의자가 이름이 아닌 의원 고유코드(`PUBL_MONA_CD`)로 오기 때문에 동명이인 문제가 없다.

## 집계 기준

- **대표발의**와 **공동발의**를 분리해 표시한다. 공동발의는 서명일 뿐이라 같은 무게로 세지 않는다.
- **가결률** 분모는 대표발의 전체(계류 포함)다. 계류 건수를 함께 표시한다.
- **표결 참여율** = (전체 표결 - 불참) / 전체 표결.
- 공약 **이행도**는 어느 기관도 공식 제공하지 않는다. 이 서비스가 법안·뉴스 근거로 판정한 값이며,
  자동 판정인지 사람 검수를 거쳤는지를 항상 함께 표시한다.

## 남은 일

- Phase 2 — 선관위 API 로 14~22대 출마·득표 이력 수집, 의원 매핑
- Phase 3 — 정책·공약마당 선거공보 PDF 수집 + LLM 구조화
- Phase 4 — 공약↔법안 매칭으로 이행 상태 초안 생성 + 운영자 검수 화면
- Phase 5 — 의원 비교, 정당·지역별 통계, 공유 카드
- 이후 — 같은 Supabase 를 백엔드로 쓰는 앱

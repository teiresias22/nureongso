---
paths:
  - "web/**"
---

# 웹 (Next.js 16, App Router)

- 이 Next.js 는 학습 데이터와 API·규칙이 다르다. 쓰기 전에 `web/node_modules/next/dist/docs/` 해당 가이드를 읽는다.
  `web/AGENTS.md` 는 `next dev` 가 다시 써 넣는 파일이라 고치지 않는다.
- DB 접근은 `src/lib/db.ts` 의 `db` 하나. GET 은 1시간 데이터 캐시(`cachedFetch`)를 탄다 — 페이지마다 fetch 옵션을 따로 달지 않는다.
- 목록은 `CARD_COLS`·`CARD_STAT_COLS` 만 받는다. `select *` 금지(558행에서 349ms→154ms 실측).
- 공용 표기·계산은 `lib/db.ts` 에 이미 있다(`eok()` 억 단위 등). 페이지에 다시 만들지 않는다.
- 화면은 직위가 아니라 **데이터 유무**로 가른다. 발의·표결이 있으면 의정활동, 공약이 있으면 공약.
- 정당 묶음은 DB 의 `party_line()` 과 화면의 `partyLine` 이 같은 규칙이다. 한쪽을 고치면 다른 쪽도.
- `sitemap.ts` 는 현직만(역대까지 넣으면 PostgREST 1000행에 조용히 잘린다). `metadataBase` 가 없으면 OG 이미지가 깨진다.
- `/m/[code]`·`/bill/[id]` 의 `generateMetadata` 설명에는 실제 수치만. OG 이미지는 수치 세 칸, 공동발의는 싣지 않는다.
- `/my` 의 지역 키는 `member.district` 가 아니라 선관위 `sd_name`/`wiw_name`(`member_area` 뷰). 국회의원만 `district` 부분일치.
- '한눈에 보기' 요약에 국외활동·연구단체·연구용역 **건수**를 올리지 않는다 — 건수가 실적처럼 읽힌다.
- 기록 없는 사람은 정렬에서 0 이 아니라 맨 뒤.
- 확인: `npm run lint && npm run build`(둘 다 `dotenvx` 를 거친다).

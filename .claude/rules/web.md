---
paths:
  - "web/**"
---

# 웹 (Next.js 16, App Router)

- 이 Next.js 는 학습 데이터와 API·규칙이 다르다. 쓰기 전에 `web/node_modules/next/dist/docs/` 해당 가이드를 읽는다.
  `web/AGENTS.md` 는 `next dev` 가 다시 써 넣는 파일이라 고치지 않는다.
- DB 접근은 `src/lib/db.ts` 의 `db` 하나. GET 은 하루 데이터 캐시(`cachedFetch`)를 탄다 — 페이지마다 fetch 옵션을 따로 달지 않는다.
  페이지 `revalidate` 도 하루(86400). ISR 은 둘 중 짧은 쪽을 따르니 한쪽만 줄이지 않는다(1시간이던 때 ISR 쓰기 무료 한도를 넘겼다).
- 그 위에 Vercel CDN 하루 캐시(`next.config.ts` 의 `headers()`)가 있다. 검색어를 읽는 페이지는 Next 가 `no-store` 를 붙여
  매 요청이 함수까지 가서 무료 한도를 먹었다. 새 동적 경로를 만들면 그 목록에 넣을지 정한다(쿠키·로그인이 없어 누구에게나 같은 화면).
- 머리글·바닥글 링크는 `<a>`(클라이언트 이동 없음). JS 를 돌리는 크롤러(OAI-SearchBot)가 법안 쪽마다 이 링크를
  눌러 보는데, Link 면 `_rsc` 요청이라 키가 보던 쪽마다 달라 CDN 을 못 타고 `/` 를 통째로 그렸다(332ms) —
  2026-10 Active CPU 무료 4시간이 이걸로 찼다. `<a>` 면 문서 요청이라 CDN 하루 캐시가 받는다.
- 본문 링크는 `@/lib/link`(prefetch 기본 꺼짐). `next/link` 는 eslint 가 막는다. 동적 경로의 prefetch 는 부분 응답이라
  싸지만, 보이는 링크마다 함수 호출이 하나씩 붙는다.
- 경로 인자만 읽는 페이지는 `generateStaticParams() { return [] }` 로 ISR(전역 캐시)에 둔다(`/bill`·`/pledge`).
  서버에서 검색어를 읽으면 다시 요청마다 그려진다 — 필요하면 클라이언트 컴포넌트(`useSearchParams`)에서. CDN 헤더는 리전마다 따로라 덜 먹힌다.
- `nureongso-puce.vercel.app` 은 본 주소로 308(`next.config.ts` `redirects`). 크롤러가 두 벌을 돌았다.
- 사용량은 Vercel → Observability → Functions(경로별 Active CPU, 12시간)와 Logs(요청별 User-Agent·실행 시간, 1시간).
- 사진 변환 크기는 `imageSizes` 의 96·192 두 벌뿐이다. 다른 폭을 쓰면 변환 벌수가 늘어 무료 5천 건을 넘긴다.
- 목록은 `CARD_COLS`·`CARD_STAT_COLS` 만 받는다. `select *` 금지(558행에서 349ms→154ms 실측).
- 공용 표기·계산은 `lib/db.ts` 에 이미 있다(`eok()` 억 단위 등). 페이지에 다시 만들지 않는다.
- 화면은 직위가 아니라 **데이터 유무**로 가른다. 발의·표결이 있으면 의정활동, 공약이 있으면 공약.
- 정당 묶음은 DB 의 `party_line()` 과 화면의 `partyLine` 이 같은 규칙이다. 한쪽을 고치면 다른 쪽도.
- `sitemap.ts` 는 현직만(역대까지 넣으면 PostgREST 1000행에 조용히 잘린다). `metadataBase` 가 없으면 OG 이미지가 깨진다.
- `/m/[code]`·`/bill/[id]` 의 `generateMetadata` 설명에는 실제 수치만. OG 이미지는 수치 세 칸, 공동발의는 싣지 않는다.
- `/my` 의 지역 키는 `member.district` 가 아니라 선관위 `sd_name`/`wiw_name`(`member_area` 뷰). 국회의원만 `district` 부분일치.
- '한눈에 보기' 요약에 국외활동·연구단체·연구용역 **건수**를 올리지 않는다 — 건수가 실적처럼 읽힌다.
- 기록 없는 사람은 정렬에서 0 이 아니라 맨 뒤.
- 쓰기는 `app/api/subscription/route.ts` 하나뿐이다(구독 신청·확인·해지, POST → `/subscription` 으로 303). service_role 키는
  거기서만 읽는다. `/subscription` 은 토큰을 읽는 화면이라 CDN 캐시 목록(`next.config.ts`)에 넣지 않는다.
- 확인: `npm run lint && npm run build`(둘 다 `dotenvx` 를 거친다).

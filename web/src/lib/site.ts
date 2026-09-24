/** 사이트 절대 주소. OG 이미지와 sitemap 은 상대 경로로는 동작하지 않는다.
 *  Vercel 은 VERCEL_PROJECT_PRODUCTION_URL 을 알아서 넣어준다.
 *
 *  db.ts 가 아니라 여기 있는 이유: db.ts 는 모듈 평가 시점에 Supabase 클라이언트를
 *  만든다. 이 상수를 db.ts 에 두면 layout.tsx 가 그걸 import 하면서 404 같은 정적
 *  페이지까지 DB 설정이 있어야 뜨게 된다. 주소 문자열은 DB 와 아무 상관이 없다. */
export const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const REPO = "https://github.com/teiresias22/nureongso";
/** 오류 제보는 이슈 양식(.github/ISSUE_TEMPLATE/data-error.yml)으로 받는다.
 *  바닥글과 판정 기준·소개의 '알려주세요' 가 모두 여기를 가리킨다. */
export const REPORT_URL = `${REPO}/issues/new?template=data-error.yml`;

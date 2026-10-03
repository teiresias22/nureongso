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

const OG_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "누렁소검은소" };

/** 페이지의 og·twitter. Next 는 페이지가 openGraph 를 적으면 레이아웃 것을 **통째로** 갈아 끼운다 —
 *  안 적으면 홈의 제목·설명·주소(og:url "/")가 그대로 나가고, 적으면 루트 opengraph-image 와
 *  siteName 이 빠진다(법안 페이지가 그랬다). 둘 다 막으려고 여기서 한 벌을 다 채운다.
 *  image: false 는 자기 opengraph-image 파일이 있는 경로(/m/[code])용이다. */
export function pageOg(
  title: string, description: string, url: string,
  { type = "website", image = true }: { type?: "website" | "article" | "profile"; image?: boolean } = {},
) {
  return {
    openGraph: {
      type, siteName: "누렁소검은소", locale: "ko_KR", title, description, url,
      ...(image && { images: [OG_IMAGE] }),
    },
    twitter: { card: "summary_large_image" as const, title, description },
  };
}

/** <script type="application/ld+json"> 본문. 법안명·요약은 바깥 데이터라 '</script>' 가 들어 있으면
 *  태그가 닫힌다. '<' 를 이스케이프한다(Next 의 JSON-LD 가이드와 같다). */
export const ldJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** 올해(한국 시각). 서버(Vercel)는 UTC 라 그냥 getFullYear() 면 1월 1일 0~9시에 지난해가 나온다. */
export const kstYear = () =>
  Number(new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric" }).format(new Date()));

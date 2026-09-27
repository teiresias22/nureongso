import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // 공공데이터를 정리해 공개하는 것이 목적이라 검색엔진도 생성형 크롤러도 다 받는다.
    // 대신 llms.txt 에 '공동발의를 대표발의처럼 세지 말 것' 같은 인용 규칙을 적어 둔다.
    rules: {
      userAgent: "*",
      allow: "/",
      // 필터·페이지 조합은 내용이 같다. canonical 로도 정리되지만 크롤링 예산부터 아낀다.
      // 의원 페이지는 물음표 붙은 주소를 다 막는다 — 법안 필터·연도·발주 연도·쪽 번호의
      // 조합이 사람당 수십 개라, 크롤러가 그걸 다 열자 DB 가 멈췄다(2026-09-27).
      disallow: ["/m/*?*", "/*?*repPage=", "/*?*coPage=", "/*?*from="],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}

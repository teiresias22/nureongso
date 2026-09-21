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
      disallow: ["/*?*repPage=", "/*?*coPage=", "/*?*from="],
    },
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}

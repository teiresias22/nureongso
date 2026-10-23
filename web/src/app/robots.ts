import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // 공공데이터를 정리해 공개하는 것이 목적이라 검색엔진과 생성형 검색·인용 크롤러
    // (OAI-SearchBot·ChatGPT-User·Claude-SearchBot·PerplexityBot 등)는 다 받는다.
    // 대신 llms.txt 에 '공동발의를 대표발의처럼 세지 말 것' 같은 인용 규칙을 적어 둔다.
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 필터·페이지 조합은 내용이 같다. canonical 로도 정리되지만 크롤링 예산부터 아낀다.
        // 의원 페이지는 물음표 붙은 주소를 다 막는다 — 법안 필터·연도·발주 연도·쪽 번호의
        // 조합이 사람당 수십 개라, 크롤러가 그걸 다 열자 DB 가 멈췄다(2026-09-27).
        // 비교는 의원 쪽마다 '비슷한 의원과 비교' 링크가 달려 쌍마다 그렸다(12시간 282회, 2026-10).
        // canonical 이 `/compare` 하나라 색인에 남는 것도 없다.
        disallow: ["/m/*?*", "/compare?", "/*?*repPage=", "/*?*coPage=", "/*?*from="],
      },
      {
        // 모델 학습용 수집기. 검색·인용으로 사람을 데려오지 않으면서 법안 2만 쪽을 통째로
        // 훑어 Vercel 무료 한도(ISR 쓰기·CPU·전송량)를 먹는다(2026-10 초과). 검색용 봇은 위에서 받는다.
        userAgent: [
          "GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Bytespider",
          "meta-externalagent", "Amazonbot", "cohere-ai", "Diffbot", "ImagesiftBot", "omgili",
        ],
        disallow: "/",
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}

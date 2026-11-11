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
        // 첫 화면의 탭·정당·정렬 조합(`/?office=…&sort=…`)도 막는다. 한 번 그릴 때 CPU 113ms·HTML 2.2MB 로
        // 쪽 중 가장 무겁고(2026-11 로컬 실측), 조합마다 CDN 키가 따로라 수백 벌을 그렸다. canonical 은 `/` 하나다.
        disallow: ["/?", "/m/*?*", "/compare?", "/*?*repPage=", "/*?*coPage=", "/*?*from="],
        // 한 달 402 뒤(2026-12-08 재개) 크롤러가 몰아서 다시 긁는다. Bing·Yandex 등은 이 값을 지킨다(구글은 무시).
        // 3초면 하루 2.8만 쪽 — 사이트맵 7천 쪽을 하루 안에 돈다.
        crawlDelay: 3,
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

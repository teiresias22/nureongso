import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 국회 사진 서버는 1MB PNG 원본을 준다. 그걸 40px 칸에 그리고 있었다.
    // 목록 한 장에 300MB 가 넘어가서 next/image 로 줄여 받는다.
    remotePatterns: [
      { protocol: "https", hostname: "www.assembly.go.kr", pathname: "/static/**" },
      { protocol: "https", hostname: "policy.nec.go.kr", pathname: "/elected_photo/**" },
    ],
    qualities: [75],
    // 고정 폭 사진은 1x·2x 를 이 목록에서 위로 맞춘다. 기본값(32…384)이면 48·80px 칸이
    // 48·96·256 세 벌로 변환됐다. Vercel 무료 변환 5천 건의 80% 를 써서(2026-10) 두 벌로 줄인다.
    imageSizes: [96, 192],
    // 원본에 Cache-Control 이 없어(실측) 이 값이 그대로 만료 기한이 된다.
    // 인물 사진은 임기 중에 바뀌지 않으므로 길게 잡는다.
    minimumCacheTTL: 2678400, // 31일
  },
  // Vercel 기본 주소가 본 주소와 똑같은 사이트로 열려 있어 크롤러가 두 벌을 돌았다(2026-10 로그의
  // OAI-SearchBot). CDN 캐시도 주소마다 따로라 같은 페이지를 두 번 그렸다. 라우팅 단계에서 돌려보낸다.
  async redirects() {
    return [{
      source: "/:path*",
      has: [{ type: "host", value: "nureongso-puce.vercel.app" }],
      destination: "https://nureongso.joon.is-a.dev/:path*",
      permanent: true,
    }];
  },
  // 주소 검색어를 읽는 페이지는 Next 가 `private, no-store` 를 붙여 매 요청이 함수까지 갔다.
  // 크롤러가 사이트맵 2만 개를 돌 때마다 Vercel Fast Origin Transfer 무료 10GB 의 75% 를 썼다(2026-10).
  // 누구에게나 같은 화면이라(쿠키·로그인 없음) Vercel CDN 에만 하루 캐시를 건다.
  // 수집이 하루 한 번(04:00)이라 길게 잡아도 잃는 게 적고, 1시간으로는 함수 CPU(무료 4시간의 85%)가 줄지 않았다.
  // 브라우저용 Cache-Control 은 그대로 두고, HTML·RSC 응답은 `_rsc` 검색어로 키가 갈린다.
  async headers() {
    const cdn = [{ key: "Vercel-CDN-Cache-Control", value: "max-age=86400, stale-while-revalidate=86400" }];
    // `/bill` 은 검색어를 안 읽어 ISR(전역 캐시)로 돈다. 여기 넣지 않는다.
    return ["/", "/m/:path*", "/stats", "/compare", "/my"].map((source) => ({ source, headers: cdn }));
  },
};

export default nextConfig;

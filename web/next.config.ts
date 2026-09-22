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
    // 원본에 Cache-Control 이 없어(실측) 이 값이 그대로 만료 기한이 된다.
    // 인물 사진은 임기 중에 바뀌지 않으므로 길게 잡는다.
    minimumCacheTTL: 2678400, // 31일
  },
};

export default nextConfig;

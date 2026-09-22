import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { SITE } from "@/lib/site";
import "./globals.css";

/** 헤더에는 찾아보는 길만 둔다. '판정 기준' 은 읽고 나서 보는 문서라 푸터로 옮겼다. */
const NAV = [
  { href: "/my", label: "내 지역" },
  { href: "/stats", label: "통계" },
  { href: "/compare", label: "비교" },
];

const TITLE = "누렁소검은소 — 선출직 공약·의정활동 기록";
const DESC =
  "국회의원·시도지사·교육감이 무슨 공약을 했고 얼마나 지켰는지, 어떤 활동을 했는지 한눈에.";

export const metadata: Metadata = {
  // 없으면 og:image 가 상대 경로로 나가 카카오톡·트위터에서 썸네일이 안 뜬다.
  metadataBase: new URL(SITE),
  title: {
    default: TITLE,
    // 브랜드를 앞에 둔다. 탭이 좁아지면 뒤가 잘리므로, 상세 페이지에 들어가도
    // 탭에는 '누렁소검은소' 가 남는다. 검색 결과에는 뒤의 이름이 그대로 나온다 —
    // 이름으로 검색해 들어오는 서비스라 그 부분을 없애면 안 된다.
    template: "누렁소검은소 — %s",
  },
  description: DESC,
  // 여기 한 번 적어두면 아래 페이지들이 제목·설명만 덮어쓰고 나머지를 물려받는다.
  // 카카오톡·네이버·X 가 모두 og: 를 읽는다.
  openGraph: {
    type: "website",
    siteName: "누렁소검은소",
    locale: "ko_KR",
    title: TITLE,
    description: DESC,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC },
  alternates: { canonical: "/" },
  // 검색엔진 소유 확인. 이 토큰은 페이지 소스에 그대로 실려 누구나 읽는 값이고,
  // 구글에 소유를 증명할 뿐 아무 권한도 주지 않는다. 그래서 그냥 코드에 둔다.
  // 확인 방식마다 토큰이 다르다 — 이건 'URL 접두어 + HTML 태그' 용이다.
  // vercel.app 은 DNS 를 우리가 못 만지므로 도메인 속성(TXT) 방식은 쓸 수 없다.
  verification: {
    google: "75dmW4emeXr54OYb8I1VfO3C_7KHchctlkWiilITKDU",
    // 네이버 서치어드바이저 코드를 받으면 여기에 같은 방식으로 넣는다.
    other: process.env.NAVER_SITE_VERIFICATION
      ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION }
      : {},
  },
  robots: {
    index: true,
    follow: true,
    // 검색결과에 본문 미리보기를 길게 허용한다. 이 사이트의 값어치는 본문 수치에 있다.
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        {/* 검색엔진에 사이트 이름과 내부 검색 경로를 알린다. 이름으로 찾아오는
            서비스라 검색창이 결과에 직접 노출되면 도달이 짧아진다. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "누렁소검은소",
              alternateName: "선출직 공약·의정활동 기록",
              url: SITE,
              inLanguage: "ko",
              potentialAction: {
                "@type": "SearchAction",
                target: { "@type": "EntryPoint", urlTemplate: `${SITE}/?q={search_term_string}` },
                "query-input": "required name=search_term_string",
              },
            }),
          }}
        />
        <header className="border-b border-line bg-card">
          {/* items-center. 로고가 이미지라 items-baseline 이면 글자 기준선에 맞추려고
              이미지가 위로 떠서 한 줄이 어긋나 보인다. */}
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
              {/* 배경이 크림색인 스케치다. 투명화하면 흰 테두리(255,255,249)와 배경
                  (249,250,243)이 6 차이라 테두리가 먹힌다. 둥근 타일로 둔다. */}
              <Image src="/logo.png" alt="" width={32} height={32} className="rounded-md" priority />
              누렁소검은소
            </Link>
            <span className="hidden text-xs text-muted sm:inline">선출직이 실제로 한 일</span>
            {/* 글씨만 있으면 본문과 구별이 안 돼 누를 수 있는 줄 모른다. 테두리를 준다. */}
            <nav className="ml-auto flex gap-1.5 text-xs">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-md border border-line px-2.5 py-1.5 text-muted transition hover:border-muted hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mt-10 border-t border-line">
          <div className="mx-auto max-w-5xl space-y-3 px-4 py-8 text-xs text-muted">
            <nav className="flex flex-wrap gap-x-4 gap-y-2">
              {[...NAV, { href: "/rules", label: "판정 기준" }].map(({ href, label }) => (
                <Link key={href} href={href} className="hover:text-foreground">
                  {label}
                </Link>
              ))}
            </nav>
            <p>
              출처: 열린국회정보 Open API, 중앙선거관리위원회 공공데이터. 수치는 수집 시점
              기준이며 집계 방식은 서비스가 정한 것입니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}

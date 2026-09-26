import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { REPO, REPORT_URL, SITE } from "@/lib/site";
import "./globals.css";

/** 헤더에는 찾아보는 길만 둔다. */
const NAV = [
  { href: "/my", label: "내 지역" },
  { href: "/stats", label: "통계" },
  { href: "/compare", label: "비교" },
];

/** 푸터에는 읽는 문서 둘만. 왜 만들었는지(about)가 먼저고, 무엇을 근거로
 *  판정했는지(rules)가 다음이다 — 처음 온 사람이 읽는 순서다. */
/** 바닥글 칸. 헤더에 있는 길(내 지역·통계·비교)도 되풀이한다 — 긴 페이지 끝에서 다시
 *  위로 올라가지 않아도 되게. 읽어야 할 두 문서(소개·판정 기준)는 '알아두기' 첫 줄에 둔다. */
const FOOTER_COLS: { title: string; links: { href: string; label: string; ext?: boolean }[] }[] = [
  {
    title: "둘러보기",
    links: [
      { href: "/", label: "전체 목록" },
      { href: "/my", label: "내 지역 대표 찾기" },
      { href: "/stats", label: "정당·지역별 통계" },
      { href: "/compare", label: "의원 비교" },
    ],
  },
  {
    title: "알아두기",
    links: [
      { href: "/about", label: "프로젝트 소개" },
      { href: "/rules", label: "판정 기준" },
      { href: "/rules#not-shown", label: "싣지 않는 정보" },
      { href: "/rules#sources", label: "데이터 출처" },
    ],
  },
  {
    title: "데이터 출처",
    links: [
      { href: "https://open.assembly.go.kr", label: "열린국회정보", ext: true },
      { href: "https://www.data.go.kr", label: "중앙선거관리위원회 공공데이터", ext: true },
      { href: "https://www.assembly.go.kr", label: "국회공보 (재산공개)", ext: true },
      { href: "https://gwanbo.go.kr", label: "전자관보 (단체장 재산공개)", ext: true },
      { href: "https://www.law.go.kr", label: "국가법령정보센터 (조례)", ext: true },
      { href: "https://www.g2b.go.kr", label: "조달청 나라장터 (발주)", ext: true },
    ],
  },
];
const OPERATOR = [
  { href: "https://www.linkedin.com/in/joonhwan-jeon-9009ba320/", label: "LinkedIn" },
  { href: "https://joon-dev-995ba.web.app/", label: "다른 프로젝트" },
];

const TITLE = "누렁소검은소 — 선출직 공약·의정활동 기록";
const DESC =
  "국회의원·시도지사·구청장·교육감이 무슨 공약을 했고 얼마나 지켰는지, 출석·표결·재산·겸직 같은 공개 기록과 함께 한눈에.";

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
            {/* 누르는 자리: 모바일은 44px(손가락), 넓은 화면은 36px. 예전엔 30px 였다. */}
            <nav className="ml-auto flex gap-1.5 text-sm">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-11 items-center rounded-md border border-line px-3 text-muted transition hover:border-muted hover:text-foreground sm:min-h-9"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mt-12 border-t border-line bg-card">
          <div className="mx-auto max-w-5xl px-4 py-10 text-sm text-muted">
            {/* 모바일은 두 칸: 소개와 데이터 출처는 한 줄 전체, 둘러보기·알아두기는 나란히.
                한 칸으로 쌓으면 바닥글만 한 화면이 넘었다. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
              <div className="col-span-2 space-y-3 lg:col-span-1">
                <Link href="/" className="flex items-center gap-2 text-base font-bold text-foreground">
                  <Image src="/logo.png" alt="" width={24} height={24} className="rounded" />
                  누렁소검은소
                </Link>
                <p className="leading-6">
                  선출직이 약속한 것과 실제로 한 일을 공개 기록으로 나란히 봅니다. 판단은 보는 분의 몫입니다.
                </p>
                <p className="text-xs leading-5">
                  개인이 운영하는 비영리 프로젝트이며 광고를 싣지 않습니다. 특정 정당·후보를 지지하거나
                  반대하지 않고, 의견 없이 기록만 싣습니다.
                </p>
                <p className="text-xs">
                  만든 사람 ·{" "}
                  {OPERATOR.map(({ href, label }, i) => (
                    <span key={href}>
                      {i > 0 && " · "}
                      <a href={href} target="_blank" rel="noopener noreferrer"
                         className="inline-block py-1.5 underline underline-offset-2 hover:text-foreground">
                        {label} <span aria-hidden>↗</span>
                      </a>
                    </span>
                  ))}
                </p>
              </div>
              {FOOTER_COLS.map((col, i) => (
                <nav key={col.title} aria-label={col.title}
                     className={i === FOOTER_COLS.length - 1 ? "col-span-2 lg:col-span-1" : ""}>
                  <h2 className="text-xs font-semibold text-foreground">{col.title}</h2>
                  <ul className="mt-2">
                    {col.links.map(({ href, label, ext }) => (
                      <li key={href}>
                        {ext ? (
                          <a href={href} target="_blank" rel="noopener noreferrer"
                             className="inline-block py-1.5 hover:text-foreground">
                            {label} <span aria-hidden>↗</span>
                          </a>
                        ) : (
                          <Link href={href} className="inline-block py-1.5 hover:text-foreground">{label}</Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>

            {/* 판정 기준 6번('사실과 다른 내용을 발견하셨다면 알려주세요')이 가리킬 곳.
                GitHub 이슈는 공개 게시판이라 그렇게 적는다. */}
            <div className="mt-8 rounded-lg border border-line bg-background px-4 py-3 leading-6">
              <b className="text-foreground">틀린 내용을 보셨나요?</b> 근거(원문 링크)와 함께{" "}
              <a href={REPORT_URL} target="_blank" rel="noopener noreferrer"
                 className="text-foreground underline underline-offset-2">
                GitHub 이슈
              </a>
              로 알려 주세요(GitHub 계정 필요). 공개 게시판이라 누구나 볼 수 있으니 개인 연락처는 적지 마세요.
              확인되면 고치고 이슈에 고친 기록을 남깁니다.
            </div>

            <div className="mt-8 flex flex-col gap-2 border-t border-line pt-5 text-xs sm:flex-row sm:items-center sm:justify-between">
              <p>
                수치는 수집 시점 기준이며, 집계 방식은 이 서비스가 정한 것입니다(
                <Link href="/rules" className="underline underline-offset-2 hover:text-foreground">판정 기준</Link>).
                공공데이터는 각 기관의 이용 조건에 따라 출처를 밝혀 씁니다.
              </p>
              <p className="shrink-0">
                © {new Date().getFullYear()} 누렁소검은소 ·{" "}
                <a href={REPO} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
                  소스 코드
                </a>
              </p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "누렁소검은소 — 선출직 공약·의정활동 기록",
  description:
    "국회의원·시도지사·교육감이 무슨 공약을 했고 얼마나 지켰는지, 어떤 활동을 했는지 한눈에.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-5xl items-baseline gap-3 px-4 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight">
              누렁소검은소
            </Link>
            <span className="text-xs text-muted">선출직이 실제로 한 일</span>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-muted">
          출처: 열린국회정보 Open API, 중앙선거관리위원회 공공데이터. 수치는 수집 시점 기준이며
          집계 방식은 서비스가 정한 것입니다.{" "}
          <Link href="/rules" className="underline underline-offset-2">
            판정 기준 보기
          </Link>
        </footer>
      </body>
    </html>
  );
}

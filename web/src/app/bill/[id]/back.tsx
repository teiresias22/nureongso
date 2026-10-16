"use client";

import { useSearchParams } from "next/navigation";
import Link from "@/lib/link";

const CLS = "text-xs text-muted hover:underline";

/** 어느 의원 페이지에서 왔는지(?from=) 알면 그리로 돌아간다. 서버가 검색어를 읽으면 법안 1.9만 쪽이
 *  전부 요청마다 그려져서, 브라우저에서 읽는다. 이름은 이 법안의 발의자 명단에서 찾는다. */
export function BackLink({ names }: { names: Record<string, string> }) {
  const from = useSearchParams().get("from") ?? "";
  const name = names[from];
  return name
    ? <Link href={`/m/${from}`} className={CLS}>← {name} 의원</Link>
    : <Link href="/" className={CLS}>← 전체 목록</Link>;
}

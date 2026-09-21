import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { SITE } from "@/lib/site";

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // 현직만 넣는다. 역대 인물까지 넣으면 2,400행이라 PostgREST 1000행 상한에 조용히 잘린다.
  // 법안 19,544건은 넣지 않는다 — 의원 페이지에서 링크로 이어지므로 크롤러가 따라간다.
  const { data, error } = await db
    .from("member")
    .select("code, updated_at")
    .eq("is_incumbent", true);
  // 조용히 빈 사이트맵을 내보내면 색인이 통째로 빠진다. 차라리 빌드를 세운다.
  if (error) throw error;

  const now = new Date();
  return [
    ...["", "/my", "/stats", "/compare", "/rules"].map((p) => ({
      url: `${SITE}${p}`,
      lastModified: now,
      priority: p === "" ? 1 : 0.5,
    })),
    ...(data ?? []).map((m) => ({
      url: `${SITE}/m/${m.code}`,
      lastModified: m.updated_at ? new Date(m.updated_at) : now,
      priority: 0.8,
    })),
  ];
}

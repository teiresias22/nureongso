import type { MetadataRoute } from "next";
import { db, myPath, regionsOf, type Area } from "@/lib/db";
import { SITE } from "@/lib/site";

export const revalidate = 86400;

const CAP = 1000; // PostgREST 가 한 번에 돌려주는 최대 행수

/** 1000행씩 끊어 전부 가져온다. 이 상한을 잊으면 조용히 잘린 사이트맵이 나가고,
 *  색인에서 빠진 페이지는 아무 오류도 남기지 않아 알아채기 어렵다.
 *
 *  OFFSET(range) 이 아니라 '마지막 키 다음부터'(keyset) 읽는다. OFFSET 은 뒤 페이지로 갈수록
 *  앞의 행을 다시 훑어서 법안 1.9만 건이면 20번에 걸쳐 약 20만 행을 읽었다 — 2026-09-27 Disk IO
 *  Budget 이 바닥났을 때 pg_stat_statements 디스크 읽기 1위가 이 조회였다. key 는 기본키라
 *  인덱스 순서로 바로 이어 읽는다. */
async function all<T extends Record<string, unknown>>(
  table: string, cols: string, key: string, eq?: [string, unknown],
): Promise<T[]> {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    let q = db.from(table).select(cols);
    if (eq) q = q.eq(eq[0], eq[1]);
    if (after !== null) q = q.gt(key, after);
    const { data, error } = await q.order(key).limit(CAP);
    // 조용히 빈 사이트맵을 내보내면 색인이 통째로 빠진다. 차라리 빌드를 세운다.
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < CAP) return out;
    after = String(rows[rows.length - 1][key]);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [members, bills, areas] = await Promise.all([
    all<{ code: string; updated_at: string | null }>(
      "member", "code, updated_at", "code", ["is_incumbent", true],
    ),
    // 법안은 '제안이유 및 주요내용' 원문이 붙은 고유 문서다. 사이트에서 가장 많은 내용이면서
    // 의원 페이지의 50건씩 페이지네이션 뒤에 숨어 있어 크롤러가 끝까지 따라오기 어렵다.
    all<{ bill_id: string; proc_dt: string | null; proposed_at: string | null }>(
      "bill", "bill_id, proc_dt, proposed_at", "bill_id",
    ),
    // 지역 허브(/my?sd=&wiw=). '송파구 국회의원' 같은 검색을 받는 곳이다.
    all<Area>("member_area", "member_code, office, sd_name, wiw_name", "member_code"),
  ]);
  const hubs = Object.entries(regionsOf(areas)).flatMap(([sd, wiws]) => [
    myPath(sd),
    ...wiws.map((w) => myPath(sd, w)),
  ]);

  return [
    ...["", "/my", "/stats", "/compare", "/network", "/rules", "/about"].map((p) => ({
      url: `${SITE}${p}`,
      lastModified: now,
      priority: p === "" ? 1 : 0.5,
    })),
    // Next 는 url 을 <loc> 에 이스케이프 없이 넣는다(resolve-route-data.js). 날 '&' 하나면
    // 사이트맵 XML 전체가 깨져 2만 주소가 통째로 읽히지 않는다.
    ...hubs.map((p) => ({ url: `${SITE}${p}`.replaceAll("&", "&amp;"), priority: 0.6 })),
    ...members.map((m) => ({
      url: `${SITE}/m/${m.code}`,
      lastModified: m.updated_at ? new Date(m.updated_at) : now,
      priority: 0.8,
    })),
    ...bills.map((b) => ({
      url: `${SITE}/bill/${b.bill_id}`,
      lastModified: new Date(b.proc_dt || b.proposed_at || now),
      priority: 0.3,
    })),
  ];
}

/** 선관위가 주는 시도·시군구. member.district 는 직위마다 모양이 달라 못 쓴다. */
export type Area = {
  member_code: string;
  office: string;
  sd_name: string | null;
  wiw_name: string | null;
};

/** 2026년 지방선거에서 광주·전남이 통합됐다. 새 시도지사·교육감만 통합 이름으로 넘어가고
 *  국회의원·구청장은 옛 시도 이름 그대로라, 합치지 않으면 광주 주민이 자기 시도지사를 놓친다. */
const SD_MERGED: Record<string, string> = {
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};
export const sido = (v: string | null) => (v ? SD_MERGED[v] ?? v : "");

/** 시도 → 시군구 목록(가나다순). /my 고르기와 구독 신청 검사(api/subscription)가 같은 목록을 쓴다.
 *  import 가 없어야 subscription.check.mjs 가 node 로 바로 읽는다. */
export function regionsOf(areas: Area[]): Record<string, string[]> {
  const by = new Map<string, Set<string>>();
  for (const a of areas) {
    // '전국' 은 비례대표다. 지역으로 찾는 화면에 넣을 자리가 없다.
    if (!a.sd_name || a.sd_name === "전국") continue;
    const k = sido(a.sd_name);
    if (!by.has(k)) by.set(k, new Set());
    if (a.wiw_name) by.get(k)!.add(a.wiw_name);
  }
  return Object.fromEntries(
    [...by]
      .sort(([a], [b]) => a.localeCompare(b, "ko"))
      .map(([k, v]) => [k, [...v].sort((x, y) => x.localeCompare(y, "ko"))]),
  );
}

import { ImageResponse } from "next/og";
import { db } from "@/lib/db";
import { LOGO } from "@/lib/logo";
import { koreanFont, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "누렁소검은소 — 선출직 공약·의정활동 기록";
export const size = OG_SIZE;
export const contentType = OG_TYPE;
export const revalidate = 86400;

/** 의원 개별 카드가 없는 모든 페이지(홈·통계·비교·내 지역·판정 기준)가 이 카드를 쓴다.
 *  카카오톡·X 에 링크를 붙였을 때 아무것도 안 뜨던 자리다. */
export default async function Image() {
  // 수치는 자랑이 아니라 '여기 기록이 있다' 는 신호다. 읽어서 넣는다.
  const [people, bills, pledges] = await Promise.all([
    db.from("member").select("code", { count: "exact", head: true }).eq("is_incumbent", true),
    db.from("bill").select("bill_id", { count: "exact", head: true }),
    db.from("pledge").select("id", { count: "exact", head: true }),
  ]);

  const facts: [string, string][] = [
    ["현직", `${(people.count ?? 0).toLocaleString()}명`],
    ["법안", `${(bills.count ?? 0).toLocaleString()}건`],
    ["공약", `${(pledges.count ?? 0).toLocaleString()}건`],
  ];

  const title = "누렁소검은소";
  const sub = "선출직이 실제로 한 일";
  const font = await koreanFont(title + sub + facts.flat().join(""));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "center", padding: 80, background: "#0b0b0c", color: "#fafafa",
          fontFamily: "Noto Sans KR",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <img src={LOGO} width={104} height={104} style={{ borderRadius: 16 }} />
          <div style={{ fontSize: 88, fontWeight: 700 }}>{title}</div>
        </div>
        <div style={{ marginTop: 20, fontSize: 40, color: "#a1a1aa" }}>{sub}</div>
        <div style={{ display: "flex", gap: 72, marginTop: 72 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, color: "#a1a1aa" }}>{k}</div>
              <div style={{ fontSize: 56, fontWeight: 700 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Noto Sans KR", data: font, weight: 700, style: "normal" }] },
  );
}

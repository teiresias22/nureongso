import { ImageResponse } from "next/og";
import { db, hasBills, lastPart, partyColor, pct, type Member, type MemberStats } from "@/lib/db";
import { koreanFont, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "의정활동 요약";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [{ data: member }, { data: stats }] = await Promise.all([
    db.from("member").select("*").eq("code", code).maybeSingle(),
    db.from("member_stats").select("*").eq("code", code).maybeSingle(),
  ]);

  const m = member as Member | null;
  const s = stats as MemberStats | null;
  const name = m?.name ?? "";
  const sub = m
    // 선수(term_count)는 국회 대수 기준이다. 오세훈 서울시장 카드에 16대 의원
    // 시절의 '초선' 이 붙어 5선 시장이 초선으로 보였다.
    ? [m.office, lastPart(m.party), lastPart(m.district),
       (m.office ?? "국회의원") === "국회의원" ? m.term_count : null]
        .filter(Boolean).join(" · ")
    : "";

  // 법안 기록이 있으면 의정활동을, 없으면 공약을 보여준다. 직위가 아니라 데이터로 가른다.
  const facts: [string, string][] = s && hasBills(s)
    ? [
        ["대표발의", `${s.rep_count.toLocaleString()}건`],
        ["공동발의", `${s.co_count.toLocaleString()}건`],
        s.vote_total > 0
          ? ["표결 참여", `${pct(s.vote_total - s.vote_absent, s.vote_total)}%`]
          : ["대표발의 가결", `${s.rep_passed.toLocaleString()}건`],
      ]
    : [
        ["공약", `${s?.pledge_count.toLocaleString() ?? 0}건`],
        ["법률로 재는 공약", `${s?.pledge_law ?? 0}건`],
        ["발의", `${s?.pledge_law_filed ?? 0}건`],
      ];

  const title = "누렁소검은소 선출직이 실제로 한 일 기준일";
  const all = name + sub + facts.flat().join("") + title + "0123456789";
  const font = await koreanFont(all);
  const accent = partyColor(m?.party);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          background: "#0b0b0c", color: "#f5f5f5", padding: 64,
          fontFamily: "Noto Sans KR", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 10, height: 92, borderRadius: 999, background: accent }} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 84, lineHeight: 1.05 }}>{name}</div>
            <div style={{ fontSize: 30, color: "#a1a1aa", marginTop: 10 }}>{sub}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {facts.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex", flexDirection: "column", flex: 1,
                border: "1px solid #27272a", borderRadius: 20, padding: "28px 32px",
              }}
            >
              <div style={{ fontSize: 26, color: "#a1a1aa" }}>{label}</div>
              <div style={{ fontSize: 60, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#71717a" }}>
          <span>누렁소검은소</span>
          <span>선출직이 실제로 한 일</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Noto Sans KR", data: font, style: "normal", weight: 700 }] },
  );
}

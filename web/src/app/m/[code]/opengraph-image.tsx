import { ImageResponse } from "next/og";
import {
  db, hasBills, lastPart, partyColor, pct, termLabel,
  type Member, type MemberStats, type OfficeTerm,
} from "@/lib/db";
import { LOGO } from "@/lib/logo";
import { koreanFont, OG_SIZE, OG_TYPE } from "@/lib/og";

export const alt = "의정활동 요약";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [{ data: member }, { data: stats }, { data: terms }, { data: rec }] = await Promise.all([
    db.from("member").select("*").eq("code", code).maybeSingle(),
    db.from("member_stats").select("*").eq("code", code).maybeSingle(),
    db.from("member_office_term").select("*").eq("member_code", code),
    // 출석·순재산. 현직만 있다(member_record) — 역대 인물은 비어 있어 그 칸을 뺀다.
    db.from("member_record").select("present, days, net_k").eq("code", code).maybeSingle(),
  ]);
  const r = rec as { present: number | null; days: number | null; net_k: number | null } | null;

  const m = member as Member | null;
  const s = stats as MemberStats | null;
  // 단체장·교육감은 국회 선수가 없다. 그 직위로 몇 번 당선됐는지로 대신한다.
  const term = ((terms ?? []) as OfficeTerm[]).find((t) => t.office === m?.office);
  const name = m?.name ?? "";
  const sub = m
    // 선수(term_count)는 국회 대수 기준이다. 오세훈 서울시장 카드에 16대 의원
    // 시절의 '초선' 이 붙어 5선 시장이 초선으로 보였다.
    ? [m.office, lastPart(m.party), lastPart(m.district),
       (m.office ?? "국회의원") === "국회의원" ? m.term_count : termLabel(term?.wins)]
        .filter(Boolean).join(" · ")
    : "";

  // 법안 기록이 있으면 의정활동을, 없으면 공약을 보여준다. 직위가 아니라 데이터로 가른다.
  // 공동발의는 싣지 않는다 — 남의 법안에 이름을 올린 것이라 대표발의와 같은 무게로 세지
  // 않는다는 원칙이 카드에서 거꾸로 보였다. 그 자리는 본회의 출석이다.
  const facts: [string, string][] = s && hasBills(s)
    ? ([
        ["대표발의", `${s.rep_count.toLocaleString()}건`],
        s.vote_total > 0
          ? ["표결 참여", `${pct(s.vote_total - s.vote_absent, s.vote_total)}%`]
          : ["대표발의 가결", `${s.rep_passed.toLocaleString()}건`],
        r?.days ? ["본회의 출석", `${pct(r.present ?? 0, r.days)}%`] : null,
      ].filter(Boolean) as [string, string][])
    : // 법안 기록이 없는 단체장·교육감. 공약 말고는 '법률로 재는 공약 0건 / 발의
      // 0건' 이 나가서 한 일이 아무것도 없는 사람처럼 보였다. 그 자리에 있는 값을
      // 넣는다 — 당선 횟수와 득표율은 '지난 임기' 를 가리키는 수치다.
      // 당선 횟수는 이름 아래 줄(termLabel)에 이미 있어 칸에서는 순재산으로 바꾼다.
      ([
        ["공약", `${s?.pledge_count.toLocaleString() ?? 0}건`],
        term?.last_vote_rate != null ? ["득표율", `${term.last_vote_rate}%`] : null,
        r?.net_k != null ? ["순재산", `${(r.net_k / 100000).toFixed(1)}억`] : null,
      ].filter(Boolean) as [string, string][]);

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

        <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#71717a" }}>
          <img src={LOGO} alt="" width={44} height={44} style={{ borderRadius: 8 }} />
          <span style={{ marginLeft: 12 }}>누렁소검은소</span>
          <span style={{ marginLeft: "auto" }}>선출직이 실제로 한 일</span>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Noto Sans KR", data: font, style: "normal", weight: 700 }] },
  );
}

import Link from "next/link";
import {
  db, hasBills, lastPart, partyColor, pct,
  type Member, type MemberStats,
} from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "의원 비교 — 누렁소검은소",
  description: "두 사람의 의정활동과 공약을 나란히 놓고 비교합니다.",
};

type SP = { a?: string; b?: string };

/** 비교 항목. higher=true 면 큰 쪽이 진하게 표시된다.
 *  '많을수록 좋다' 는 뜻이 아니라 '어느 쪽이 큰가' 만 보여준다. */
const ROWS: {
  label: string;
  get: (s: MemberStats) => number;
  fmt?: (n: number, s: MemberStats) => string;
  note?: string;
}[] = [
  { label: "대표발의", get: (s) => s.rep_count, fmt: (n) => `${n.toLocaleString()}건` },
  { label: "공동발의", get: (s) => s.co_count, fmt: (n) => `${n.toLocaleString()}건`,
    note: "남의 법안에 이름을 올린 것" },
  { label: "대표발의 가결", get: (s) => s.rep_passed,
    fmt: (n, s) => `${n}건 (${pct(n, s.rep_count)}%)` },
  { label: "본회의 표결 참여", get: (s) => (s.vote_total ? (s.vote_total - s.vote_absent) / s.vote_total : 0),
    fmt: (_, s) => `${pct(s.vote_total - s.vote_absent, s.vote_total)}%` },
  { label: "공약", get: (s) => s.pledge_count, fmt: (n) => `${n.toLocaleString()}건` },
  { label: "법률로 재는 공약", get: (s) => s.pledge_law,
    fmt: (n, s) => (n ? `${n}건 중 발의 ${s.pledge_law_filed} · 통과 ${s.pledge_law_passed}` : "—"),
    note: "나머지 유형은 아직 측정 수단이 없다" },
];

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { a, b } = await searchParams;

  // 선택 목록은 현직만. 558명이라 한 번에 받아도 PostgREST 상한(1000) 안이다.
  const { data: all } = await db
    .from("member")
    .select("code, name, office, party, district")
    .eq("is_incumbent", true)
    .order("name");

  const codes = [a, b].filter(Boolean) as string[];
  const [{ data: members }, { data: stats }] = codes.length
    ? await Promise.all([
        db.from("member").select("*").in("code", codes),
        db.from("member_stats").select("*").in("code", codes),
      ])
    : [{ data: [] }, { data: [] }];

  const byCode = new Map((members ?? []).map((m) => [m.code, m as Member]));
  const statBy = new Map((stats ?? []).map((s) => [s.code, s as MemberStats]));
  const picked = [a, b].map((c) => (c ? byCode.get(c) : undefined));
  const both = picked[0] && picked[1];

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header>
        <h1 className="text-xl font-bold">의원 비교</h1>
        <p className="mt-1 text-sm text-muted">
          두 사람을 나란히 놓고 봅니다. 숫자가 크다고 더 일을 잘한 것은 아닙니다. 지역구
          사정과 임기가 다르면 비교가 어긋날 수 있습니다.
        </p>
      </header>

      <form className="flex flex-wrap gap-2">
        {(["a", "b"] as const).map((k) => (
          <select
            key={k}
            name={k}
            defaultValue={(k === "a" ? a : b) ?? ""}
            className="min-w-40 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
          >
            <option value="">{k === "a" ? "첫 번째 사람" : "두 번째 사람"}</option>
            {(all ?? []).map((m) => (
              <option key={m.code} value={m.code}>
                {m.name} · {lastPart(m.party)} · {lastPart(m.district)}
              </option>
            ))}
          </select>
        ))}
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          비교
        </button>
      </form>

      {!both ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          두 사람을 고르면 비교표가 나옵니다.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {picked.map((m) => (
              <Link
                key={m!.code}
                href={`/m/${m!.code}`}
                className="rounded-lg border border-line bg-card p-3 transition hover:border-muted"
              >
                <span className="flex items-baseline gap-2">
                  <span
                    className="h-3 w-1 shrink-0 rounded-full"
                    style={{ background: partyColor(m!.party) }}
                  />
                  <b className="truncate">{m!.name}</b>
                </span>
                <p className="mt-1 truncate text-xs text-muted">
                  {[m!.office, lastPart(m!.party), lastPart(m!.district), m!.term_count]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-card">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {ROWS.map((row) => {
                  const vals = picked.map((m) => statBy.get(m!.code));
                  // 둘 다 법안 기록이 없으면 법안 항목은 숨긴다 (단체장 등)
                  if (row.label.includes("발의") || row.label.includes("표결")) {
                    if (!vals.some((s) => hasBills(s))) return null;
                  }
                  const nums = vals.map((s) => (s ? row.get(s) : 0));
                  const win = nums[0] === nums[1] ? -1 : nums[0] > nums[1] ? 0 : 1;
                  return (
                    <tr key={row.label} className="border-b border-line/60 last:border-0">
                      {[0, 1].map((i) => (
                        <td
                          key={i}
                          className={`w-[38%] px-4 py-3 tabular-nums ${
                            i === 0 ? "text-right" : "text-left"
                          } ${win === i ? "font-bold" : "text-muted"}`}
                        >
                          {vals[i]
                            ? (row.fmt ?? ((n) => String(n)))(nums[i], vals[i]!)
                            : "—"}
                        </td>
                      ))}
                      <td className="px-2 py-3 text-center text-[11px] text-muted">
                        {row.label}
                        {row.note && <span className="block opacity-70">{row.note}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted">
            가결률 분모에는 계류 중인 법안이 포함됩니다. 공약 이행 판정 기준은{" "}
            <Link href="/rules" className="underline underline-offset-2">
              판정 기준
            </Link>
            에 있습니다.
          </p>
        </>
      )}
    </div>
  );
}

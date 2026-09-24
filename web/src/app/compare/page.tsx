import Link from "next/link";
import {
  attendRate, db, hasBills, lastPart, partyColor, pct, wonK,
  type Member, type MemberStats,
} from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "의원 비교",
  alternates: { canonical: "/compare" },
  description: "두 사람의 의정활동과 공약을 나란히 놓고 비교합니다.",
};

type SP = { a?: string; b?: string };

/** 비교 항목. 큰 쪽을 굵게 칠하지 않는다 — '이긴 쪽' 으로 읽혀서 이 페이지의 첫 문장
 *  ('숫자가 크다고 더 일을 잘한 것은 아니다')과 어긋났다. 크기는 두 값 중 큰 쪽 기준의
 *  막대 길이로만 보인다. */
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
  // 표결 기록이 없는 사람(임기 중 들어온 의원)을 0% 로 두면 비교에서 꼴찌로 진다.
  { label: "본회의 표결 참여",
    get: (s) => attendRate(s) ?? -1,
    fmt: (_, s) => (attendRate(s) == null ? "기록 없음" : `${attendRate(s)}%`) },
  { label: "공약", get: (s) => s.pledge_count, fmt: (n) => `${n.toLocaleString()}건` },
  { label: "법률로 재는 공약", get: (s) => s.pledge_law,
    fmt: (n, s) => (n ? `${n}건 중 발의 ${s.pledge_law_filed} · 통과 ${s.pledge_law_passed}` : "—"),
    note: "나머지 유형은 아직 측정 수단이 없다" },
];

export default async function ComparePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { a, b } = await searchParams;

  // 국회의원만 고를 수 있다. 단체장·교육감은 발의도 표결도 없어서 비교표가
  // 공약 건수 한 줄로 쪼그라든다. 그 한 줄로 두 사람을 견주는 건 뜻이 없다.
  const { data: all } = await db
    .from("member")
    .select("code, name, office, party, district")
    .eq("is_incumbent", true)
    .eq("office", "국회의원")
    .order("name");

  const codes = [a, b].filter(Boolean) as string[];
  const [{ data: members }, { data: stats }, { data: atts }, { data: lines }, { data: assets }] = codes.length
    ? await Promise.all([
        db.from("member").select("*").in("code", codes),
        db.from("member_stats").select("*").in("code", codes),
        db.from("attendance").select("member_code, present, days").eq("age", 22).in("member_code", codes),
        db.from("member_party_line").select("code, party_counted, against_party").in("code", codes),
        db.from("asset_report").select("member_code, total_now_k, notice_date").in("member_code", codes)
          .order("notice_date", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const attBy = new Map(((atts ?? []) as { member_code: string; present: number; days: number }[])
    .map((r) => [r.member_code, r]));
  const lineBy = new Map(((lines ?? []) as { code: string; party_counted: number; against_party: number }[])
    .map((r) => [r.code, r]));
  const assetBy = new Map<string, { total_now_k: number; notice_date: string }>();
  for (const r of (assets ?? []) as { member_code: string; total_now_k: number; notice_date: string }[]) {
    if (!assetBy.has(r.member_code)) assetBy.set(r.member_code, r); // 최근 것이 먼저 온다
  }

  const byCode = new Map((members ?? []).map((m) => [m.code, m as Member]));
  const statBy = new Map((stats ?? []).map((s) => [s.code, s as MemberStats]));
  const picked = [a, b].map((c) => (c ? byCode.get(c) : undefined));
  // 주소로 직접 들어온 단체장·교육감. 고를 수 없게 해놨어도 링크는 올 수 있다.
  // byCode 로는 못 거른다 — 그건 code 로만 읽어와서 직위를 안 봤다.
  const wrong = picked.some((m) => m && (m.office ?? "국회의원") !== "국회의원");
  const both = picked[0] && picked[1];

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header>
        <h1 className="text-xl font-bold">의원 비교</h1>
        <p className="mt-1 text-sm text-muted">
          국회의원 두 사람을 나란히 놓고 봅니다. 숫자가 크다고 더 일을 잘한 것은
          아닙니다. 지역구 사정과 임기가 다르면 비교가 어긋날 수 있습니다.
        </p>
      </header>

      <form className="flex flex-wrap gap-2">
        {(["a", "b"] as const).map((k) => (
          <select
            key={k}
            name={k}
            aria-label={k === "a" ? "첫 번째 사람" : "두 번째 사람"}
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

      {wrong ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          국회의원끼리만 비교합니다. 단체장·교육감은 발의도 표결도 없어 견줄 숫자가
          공약 건수뿐이라, 나란히 놓으면 오히려 오해를 만듭니다.
        </p>
      ) : !both ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          {picked[0] || picked[1]
            ? `${(picked[0] ?? picked[1])!.name} 님을 담았습니다. 한 명 더 고르면 비교표가 나옵니다.`
            : "두 사람을 고르면 비교표가 나옵니다."}
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
                  <b className="truncate text-base">{m!.name}</b>
                </span>
                <p className="mt-1 truncate text-sm text-muted">
                  {[
                    m!.office,
                    lastPart(m!.party),
                    lastPart(m!.district),
                    (m!.office ?? "국회의원") === "국회의원" ? m!.term_count : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </Link>
            ))}
          </div>

          {/* 표 대신 행마다 격자다. 좁은 화면에선 항목 이름을 한 줄로 올리고 두 값을 그 아래
              나란히 둔다 — 세 칸 표로는 이름 칸이 좁아 '대표발의 가 / 결' 처럼 끊겼다. */}
          <div role="table" aria-label="두 사람 비교" className="divide-y divide-line/60 overflow-hidden rounded-lg border border-line bg-card text-sm">
                {(() => {
                  const vals = picked.map((m) => statBy.get(m!.code));
                  const noBills = !vals.some((st) => hasBills(st));
                  const cs = picked.map((m) => m!.code);
                  // 한 행 = 항목 이름 + 두 사람 값. num 은 막대 길이(없으면 막대 없음), text 는 글자.
                  const rows: { label: string; note?: string; cells: { num: number | null; text: string }[] }[] = [];
                  for (const row of ROWS) {
                    if (noBills && (row.label.includes("발의") || row.label.includes("표결"))) continue;
                    rows.push({
                      label: row.label,
                      note: row.note,
                      cells: vals.map((st) => {
                        if (!st) return { num: null, text: "—" };
                        const n = row.get(st);
                        return { num: n < 0 ? null : n, text: (row.fmt ?? ((x) => String(x)))(n, st) };
                      }),
                    });
                    // 표결 참여 바로 아래에 출석률·정당 표를 둔다 — 같은 본회의 이야기다.
                    if (row.label === "본회의 표결 참여") {
                      rows.push({
                        label: "본회의 출석률",
                        note: "제22대 회의일 기준. 청가·출장도 출석이 아니다",
                        cells: cs.map((c) => {
                          const a = attBy.get(c);
                          return a
                            ? { num: a.present / a.days, text: `${((a.present / a.days) * 100).toFixed(1)}% (${a.present}/${a.days}일)` }
                            : { num: null, text: "기록 없음" };
                        }),
                      });
                      rows.push({
                        label: "정당 다수와 다른 표",
                        note: "좋고 나쁨이 아니다",
                        cells: cs.map((c) => {
                          const l = lineBy.get(c);
                          return l?.party_counted
                            ? { num: l.against_party / l.party_counted,
                                text: `${((l.against_party / l.party_counted) * 100).toFixed(1)}% (${l.against_party}표)` }
                            : { num: null, text: "셀 수 없음" };
                        }),
                      });
                    }
                  }
                  rows.push({
                    label: "순재산",
                    note: "국회공보 최근 신고",
                    cells: cs.map((c) => {
                      const r = assetBy.get(c);
                      return r
                        ? { num: r.total_now_k, text: `${wonK(r.total_now_k)} (${r.notice_date.slice(0, 7).replace("-", ".")})` }
                        : { num: null, text: "공개 전" };
                    }),
                  });
                  return rows.map((row) => {
                    const max = Math.max(...row.cells.map((c) => Math.abs(c.num ?? 0)), 0) || 1;
                    return (
                      <div key={row.label} role="row" className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[30%_1fr_1fr]">
                        {/* 항목 이름이 먼저다. 값·값·이름 순이면 무엇을 재는 숫자인지가
                            맨 나중에 나와 눈이 오른쪽까지 갔다가 되돌아와야 한다. */}
                        <div role="rowheader" className="col-span-2 font-medium sm:col-span-1">
                          {row.label}
                          {row.note && <span className="ml-1.5 text-xs font-normal text-muted sm:ml-0 sm:mt-0.5 sm:block">{row.note}</span>}
                        </div>
                        {row.cells.map((c, i) => (
                          <div key={i} role="cell">
                            <span className={`block text-right font-semibold ${c.num == null ? "font-normal text-muted" : ""}`}>
                              {c.text}
                            </span>
                            {c.num != null && (
                              <span className="mt-1.5 flex h-1.5 justify-end rounded-full bg-foreground/5">
                                <span
                                  className="block h-1.5 rounded-full"
                                  style={{
                                    width: `${Math.max(2, (Math.abs(c.num) / max) * 100)}%`,
                                    background: c.num < 0 ? "var(--viz-neg)" : "var(--viz-1)",
                                  }}
                                />
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  });
                })()}
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

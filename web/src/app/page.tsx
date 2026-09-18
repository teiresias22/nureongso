import Link from "next/link";
import { db, lastPart, partyColor, pct, type Member, type MemberStats } from "@/lib/db";

export const revalidate = 3600;

type SP = { q?: string; party?: string; sort?: string };

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const { q = "", party = "", sort = "rep" } = await searchParams;

  const [{ data: members }, { data: stats }] = await Promise.all([
    db.from("member").select("*").eq("is_incumbent", true).order("name"),
    db.from("member_stats").select("*"),
  ]);

  if (!members?.length) return <Empty />;

  const statById = new Map((stats ?? []).map((s: MemberStats) => [s.code, s]));
  const parties = [...new Set(members.map((m: Member) => lastPart(m.party)).filter(Boolean))].sort();

  let rows = members as Member[];
  if (q) rows = rows.filter((m) => m.name.includes(q) || (m.district ?? "").includes(q));
  if (party) rows = rows.filter((m) => lastPart(m.party) === party);

  rows = [...rows].sort((a, b) => {
    const sa = statById.get(a.code);
    const sb = statById.get(b.code);
    if (sort === "co") return (sb?.co_count ?? 0) - (sa?.co_count ?? 0);
    if (sort === "name") return a.name.localeCompare(b.name, "ko");
    return (sb?.rep_count ?? 0) - (sa?.rep_count ?? 0);
  });

  return (
    <div className="space-y-5">
      <form className="flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="이름 또는 지역구"
          className="min-w-40 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        <select
          name="party"
          defaultValue={party}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="">전체 정당</option>
          {parties.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="rep">대표발의 많은 순</option>
          <option value="co">공동발의 많은 순</option>
          <option value="name">이름순</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          검색
        </button>
      </form>

      <p className="text-xs text-muted">현역 의원 {rows.length}명</p>

      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((m) => {
          const s = statById.get(m.code);
          return (
            <li key={m.code}>
              <Link
                href={`/m/${m.code}`}
                className="flex gap-3 rounded-lg border border-line bg-card p-3 transition hover:border-muted"
              >
                <span
                  className="w-1 shrink-0 rounded-full"
                  style={{ background: partyColor(m.party) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{m.name}</span>
                    <span className="truncate text-xs text-muted">
                      {lastPart(m.party)} · {m.district} · {m.term_count}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-muted">
                    <span>
                      대표발의 <b className="text-foreground">{s?.rep_count ?? 0}</b>
                    </span>
                    <span>
                      공동발의 <b className="text-foreground">{s?.co_count ?? 0}</b>
                    </span>
                    <span>
                      표결참여{" "}
                      <b className="text-foreground">
                        {pct(s?.vote_attended ?? 0, s?.vote_total ?? 0)}%
                      </b>
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-lg border border-line bg-card p-6 text-sm">
      <p className="font-semibold">데이터가 없습니다.</p>
      <p className="mt-2 text-muted">
        <code>supabase/schema.sql</code> 를 실행한 뒤{" "}
        <code>python collector/ingest.py all --age 22</code> 로 수집하세요.
      </p>
    </div>
  );
}

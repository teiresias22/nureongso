import Link from "next/link";
import {
  db, hasBills, hasPledges, lastPart, partyColor, pct,
  type Member, type MemberStats,
} from "@/lib/db";

export const revalidate = 3600;

type SP = { q?: string; party?: string; sort?: string; elect?: string; office?: string };

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const { q = "", party = "", sort = "rep", elect = "", office = "" } = await searchParams;

  // 현직 전원을 받아 클라이언트에서 거른다. PostgREST 상한이 1000행이라
  // 지방의원(약 3,900명)까지 넣으면 여기서 조용히 잘린다. 그때는 검색·필터를
  // 서버 쿼리로 내리고 페이지네이션을 붙여야 한다.
  const [{ data: members }, { data: stats }] = await Promise.all([
    db.from("member").select("*").eq("is_incumbent", true).order("name"),
    db.from("member_stats").select("*").eq("is_incumbent", true),
  ]);

  if (!members?.length) return <Empty />;

  const statById = new Map((stats ?? []).map((s: MemberStats) => [s.code, s]));
  const parties = [...new Set(members.map((m: Member) => lastPart(m.party)).filter(Boolean))].sort();
  const offices = [...new Set(members.map((m: Member) => m.office ?? "국회의원"))].sort();

  let rows = members as Member[];
  if (q) rows = rows.filter((m) => m.name.includes(q) || (m.district ?? "").includes(q));
  if (party) rows = rows.filter((m) => lastPart(m.party) === party);
  if (elect) rows = rows.filter((m) => m.elect_type === elect);
  if (office) rows = rows.filter((m) => (m.office ?? "국회의원") === office);

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
        {offices.length > 1 && (
          <select
            name="office"
            defaultValue={office}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm"
          >
            <option value="">전체 직위</option>
            {offices.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
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
          name="elect"
          defaultValue={elect}
          className="rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="">지역구+비례</option>
          <option value="지역구">지역구만</option>
          <option value="비례대표">비례대표만</option>
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

      <p className="text-xs text-muted">현직 {rows.length}명</p>

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
                    <ElectBadge type={m.elect_type} />
                    <span className="truncate text-xs text-muted">
                      {[lastPart(m.party), m.district, m.term_count].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-xs text-muted">
                    {hasBills(s) ? (
                      <>
                        <span>
                          대표발의 <b className="text-foreground">{s?.rep_count ?? 0}</b>
                        </span>
                        <span>
                          공동발의 <b className="text-foreground">{s?.co_count ?? 0}</b>
                        </span>
                        <span>
                          표결참여{" "}
                          <b className="text-foreground">
                            {pct((s?.vote_total ?? 0) - (s?.vote_absent ?? 0), s?.vote_total ?? 0)}%
                          </b>
                        </span>
                      </>
                    ) : hasPledges(s) ? (
                      <>
                        <span>
                          대표공약 <b className="text-foreground">{s!.pledge_count}</b>건
                        </span>
                        <span>
                          이행 <b className="text-foreground">{pct(s!.pledge_done, s!.pledge_count)}%</b>
                        </span>
                      </>
                    ) : (
                      <span>수집된 활동 기록 없음</span>
                    )}
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

/** 비례대표는 지역구가 없어 목록에서 눈에 안 띈다. 배지로 구분한다. */
function ElectBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const prop = type.includes("비례");
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
        prop ? "bg-violet-600 text-white" : "border border-line text-muted"
      }`}
    >
      {prop ? "비례" : "지역구"}
    </span>
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

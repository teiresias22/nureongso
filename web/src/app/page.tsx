import Image from "next/image";
import Link from "next/link";
import {
  attendRate, db, hasBills, hasPledges, lastPart, partyColor, pct, shortDistrict, termLabel,
  type Member, type MemberStats, type OfficeTerm,
} from "@/lib/db";

export const revalidate = 3600;

type SP = { q?: string; party?: string; sort?: string; elect?: string; office?: string };

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const { q = "", party = "", sort = "rep", elect = "", office = "" } = await searchParams;

  // 현직 전원을 받아 클라이언트에서 거른다. PostgREST 상한이 1000행이라
  // 지방의원(약 3,900명)까지 넣으면 여기서 조용히 잘린다. 그때는 검색·필터를
  // 서버 쿼리로 내리고 페이지네이션을 붙여야 한다.
  const [{ data: members }, { data: stats }, { data: terms }] = await Promise.all([
    db.from("member").select("*").eq("is_incumbent", true).order("name"),
    db.from("member_stats").select("*").eq("is_incumbent", true),
    // 역대 당선인까지 합치면 2,400행이 넘어 PostgREST 1000행 상한에 걸린다.
    // 목록에는 현직만 필요하다.
    db
      .from("member_office_term")
      .select("member_code, office, wins, last_vote_rate")
      .eq("is_current", true),
  ]);

  if (!members?.length) return <Empty />;

  const statById = new Map((stats ?? []).map((s: MemberStats) => [s.code, s]));
  // 단체장·교육감은 국회 선수가 없다. 그 직위로 몇 번 당선됐는지로 대신한다.
  const termBy = new Map(
    ((terms ?? []) as OfficeTerm[]).map((t) => [`${t.member_code}|${t.office}`, t]),
  );
  const parties = [...new Set(members.map((m: Member) => lastPart(m.party)).filter(Boolean))].sort();
  const offices = [...new Set(members.map((m: Member) => m.office ?? "국회의원"))].sort();

  let rows = members as Member[];
  if (q) rows = rows.filter((m) => m.name.includes(q) || (m.district ?? "").includes(q));
  if (party) rows = rows.filter((m) => lastPart(m.party) === party);
  // 지역구/비례는 국회 개념이다. 단체장·교육감에게 남아 있는 elect_type 은 의원
  // 시절 값이라, 안 거르면 '비례대표만' 에 교육감·구청장이 섞인다.
  if (elect)
    rows = rows.filter((m) => (m.office ?? "국회의원") === "국회의원" && m.elect_type === elect);
  if (office) rows = rows.filter((m) => (m.office ?? "국회의원") === office);

  rows = [...rows].sort((a, b) => {
    const sa = statById.get(a.code);
    const sb = statById.get(b.code);
    if (sort === "co") return (sb?.co_count ?? 0) - (sa?.co_count ?? 0);
    if (sort === "vote") {
      // 표결이 0건인 사람(단체장·교육감)은 pct 가 0 이라 자연히 뒤로 간다.
      // 비율이 같으면 표결 수가 많은 쪽을 위에 둔다. 임기 중 보궐로 들어와
      // 14건만 치른 사람이 1,847건을 다 치른 사람을 제치면 읽는 사람이 속는다.
      const ra = pct(sa ? sa.vote_total - sa.vote_absent : 0, sa?.vote_total ?? 0);
      const rb = pct(sb ? sb.vote_total - sb.vote_absent : 0, sb?.vote_total ?? 0);
      return rb - ra || (sb?.vote_total ?? 0) - (sa?.vote_total ?? 0);
    }
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
          <option value="vote">표결참여 높은 순</option>
          <option value="name">이름순</option>
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          검색
        </button>
      </form>

      <p className="text-xs text-muted">현직 {rows.length}명</p>

      {/* prefetch 를 끈다. 카드가 558개라 스크롤하면 Next 가 보이는 링크마다 RSC
          페이로드를 미리 받는다. 요청 수백 건이 사진과 대역폭을 두고 다툰다. */}
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((m) => {
          const s = statById.get(m.code);
          return (
            <li key={m.code}>
              <Link
                href={`/m/${m.code}`}
                prefetch={false}
                className="flex gap-3 rounded-lg border border-line bg-card p-3 transition hover:border-muted"
              >
                <span
                  className="w-1 shrink-0 rounded-full"
                  style={{ background: partyColor(m.party) }}
                />
                <Photo src={m.photo_url} name={m.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {/* 이름은 줄이지 않는다. 누구인지가 이 카드의 핵심이다. */}
                    <span className="whitespace-nowrap font-semibold">{m.name}</span>
                    {(m.office ?? "국회의원") === "국회의원" && (
                      <ElectBadge type={m.elect_type} />
                    )}
                    <span className="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
                      {m.office ?? "국회의원"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {[
                      lastPart(m.party),
                      shortDistrict(m.district),
                      // 국회 선수(term_count)는 국회 대수 기준이라 단체장에게 붙이면
                      // 오해를 준다. 오세훈은 16대 의원 '초선' 이지만 서울시장 5선이다.
                      (m.office ?? "국회의원") === "국회의원"
                        ? m.term_count
                        : termLabel(termBy.get(`${m.code}|${m.office}`)?.wins),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
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
                            {attendRate(s) == null ? "기록 없음" : `${attendRate(s)}%`}
                          </b>
                        </span>
                      </>
                    ) : hasPledges(s) ? (
                      <>
                        <span>
                          공약 <b className="text-foreground">{s!.pledge_count}</b>건
                        </span>
                        <span>
                          이행{" "}
                          <b className="text-foreground">
                            {s!.pledge_done > 0 ? `${pct(s!.pledge_done, s!.pledge_count)}%` : "미집계"}
                          </b>
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

/** 비례대표만 표시한다. 지역구는 옆에 지역명이 이미 있어 배지가 중복이다. */
function ElectBadge({ type }: { type?: string | null }) {
  if (!type?.includes("비례")) return null;
  return (
    <span className="shrink-0 rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
      비례
    </span>
  );
}

/** 사진이 없거나 못 불러오면 이름이 뒤에서 드러난다. 클라이언트 스크립트 없이 처리한다. */
export function Photo({ src, name }: { src?: string | null; name: string }) {
  return (
    <span className="relative grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded bg-line text-xs text-muted">
      {name.slice(-2)}
      {src && (
        <Image
          src={src}
          alt=""
          width={40}
          height={48}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
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

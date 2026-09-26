import Image from "next/image";
import Link from "next/link";
import {
  attendRate, officeBadge, CARD_COLS, CARD_STAT_COLS, db, hasBills, hasPledges, lastPart, partyColor, pct, shortDistrict, termText,
  type CardStats, type Member, type OfficeTerm,
} from "@/lib/db";

export const revalidate = 3600;

type SP = { q?: string; party?: string; sort?: string; elect?: string; office?: string };

/** 탭 순서. 데이터에서 뽑으면 가나다순이라 국회의원이 교육감 뒤로 간다. */
const OFFICES = ["국회의원", "시도지사", "구시군의장", "교육감"];

/** 직위마다 잴 수 있는 것이 다르다. 발의·표결은 국회에만 있고, 단체장·교육감은
 *  공약·득표율·당선 횟수뿐이다. 한 메뉴에 다 넣으면 어느 쪽을 고르든 절반은
 *  0 으로 깔린다 — 대표발의 순으로 보면 단체장 259명이 뒤에 무의미하게 쌓였다.
 *  첫 항목이 그 탭의 기본 정렬이다. */
const SORTS: Record<string, [string, string][]> = {
  국회의원: [["rep", "대표발의 많은 순"], ["co", "공동발의 많은 순"],
           ["vote", "표결참여 높은 순"], ["attend", "본회의 출석률 높은 순"],
           ["asset", "순재산 많은 순"], ["name", "이름순"]],
  기본: [["pledge", "공약 많은 순"], ["rate", "득표율 높은 순"],
        ["wins", "당선 많은 순"], ["asset", "순재산 많은 순"], ["name", "이름순"]],
  // 직위가 섞인 화면에서 순위를 매기면 비교가 성립하지 않는다. 찾아보는 용도라
  //  정렬 메뉴를 아예 안 띄운다.
  전체: [["name", "이름순"]],
};
const sortsFor = (office: string) =>
  office ? SORTS[office] ?? SORTS.기본 : SORTS.전체;

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const { q = "", party = "", elect = "", office = "", sort: asked } = await searchParams;
  const allowed = sortsFor(office);
  // 탭을 옮기면 이전 탭의 정렬이 따라온다. 교육감 화면의 '대표발의 순' 은 뜻이
  // 없으므로 그 탭에 없는 정렬은 기본값으로 되돌린다.
  const sort = allowed.some(([k]) => k === asked) ? asked! : allowed[0][0];

  // 현직 전원을 받아 클라이언트에서 거른다. PostgREST 상한이 1000행이라
  // 지방의원(약 3,900명)까지 넣으면 여기서 조용히 잘린다. 그때는 검색·필터를
  // 서버 쿼리로 내리고 페이지네이션을 붙여야 한다.
  const [{ data: members }, { data: stats }, { data: terms }, { data: vacant }, { data: records }] =
    await Promise.all([
    db.from("member").select(CARD_COLS).eq("is_incumbent", true).order("name"),
    db.from("member_stats").select(CARD_STAT_COLS).eq("is_incumbent", true),
    // 역대 당선인까지 합치면 2,400행이 넘어 PostgREST 1000행 상한에 걸린다.
    // 목록에는 현직만 필요하다.
    db
      .from("member_office_term")
      .select("member_code, office, wins, last_vote_rate")
      .eq("is_current", true),
    // 정원과 현직 수가 다른 이유를 화면에 적기 위한 것. 선관위 당선 기록과 국회
    // 현역 명부를 대조해 비어 있는 지역구를 센다 (뷰 vacant_seat).
    db.from("vacant_seat").select("sd_name, district, last_name"),
    // 출결·재산·겸직 등 공개 기록. 현직 한 사람당 한 줄(member_record, 560행 안쪽).
    db.from("member_record").select("code, present, days, net_k, trips, studies, sidejob_flagged"),
  ]);

  if (!members?.length) return <Empty />;

  const vacancies = (vacant ?? []) as { sd_name: string; district: string; last_name: string }[];
  const statById = new Map((stats ?? []).map((s: CardStats) => [s.code, s]));
  const recById = new Map(((records ?? []) as Rec[]).map((r) => [r.code, r]));
  // 출석률. 기록이 없으면 -1 로 뒤에 둔다(0% 와 '기록 없음' 은 다르다).
  const attendOf = (r?: Rec) => (r?.days ? (r.present ?? 0) / r.days : -1);
  // 단체장·교육감은 국회 선수가 없다. 그 직위로 몇 번 당선됐는지로 대신한다.
  const termBy = new Map(
    ((terms ?? []) as OfficeTerm[]).map((t) => [`${t.member_code}|${t.office}`, t]),
  );
  const offices = [...new Set(members.map((m: Member) => m.office ?? "국회의원"))];
  const counts = new Map<string, number>();
  for (const m of members as Member[]) {
    const o = m.office ?? "국회의원";
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }

  let rows = members as Member[];
  if (office) rows = rows.filter((m) => (m.office ?? "국회의원") === office);
  // 정당 목록은 지금 탭 안에서 뽑는다. 전체에서 뽑으면 교육감 탭에 '더불어민주당'
  // 이 떠 있고 고르면 0명이 나온다 (교육감은 정당이 없다).
  const parties = [...new Set(rows.map((m) => lastPart(m.party)).filter(Boolean))].sort();
  if (q) rows = rows.filter((m) => m.name.includes(q) || (m.district ?? "").includes(q));
  if (party) rows = rows.filter((m) => lastPart(m.party) === party);
  // 지역구/비례는 국회 개념이다. 단체장·교육감에게 남아 있는 elect_type 은 의원
  // 시절 값이라, 안 거르면 '비례대표만' 에 교육감·구청장이 섞인다.
  if (elect)
    rows = rows.filter((m) => (m.office ?? "국회의원") === "국회의원" && m.elect_type === elect);

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
    if (sort === "pledge") return (sb?.pledge_count ?? 0) - (sa?.pledge_count ?? 0);
    if (sort === "rate" || sort === "wins") {
      const ta = termBy.get(`${a.code}|${a.office}`);
      const tb = termBy.get(`${b.code}|${b.office}`);
      // 득표율이 없는 사람(비례대표·무투표당선)은 -1 로 뒤에 둔다. 0 으로 두면
      // '0% 를 받았다' 와 구별이 안 되고, 무투표당선이 꼴찌로 보인다.
      if (sort === "rate")
        return (tb?.last_vote_rate ?? -1) - (ta?.last_vote_rate ?? -1);
      return (tb?.wins ?? 0) - (ta?.wins ?? 0);
    }
    if (sort === "attend") {
      const ra = recById.get(a.code), rb = recById.get(b.code);
      // 비율이 같으면 회의일수가 많은 쪽을 위에 — 임기 중 들어온 사람이 몇 번 출석으로
      // 100% 가 돼 앞에 서지 않게 한다(표결참여와 같은 이유).
      return attendOf(rb) - attendOf(ra) || (rb?.days ?? 0) - (ra?.days ?? 0);
    }
    if (sort === "asset") {
      // 재산이 아직 공개되지 않은 사람(새로 취임)은 맨 뒤. 0 으로 두면 '재산 0' 으로 읽힌다.
      const va = recById.get(a.code)?.net_k, vb = recById.get(b.code)?.net_k;
      return (vb ?? -Infinity) - (va ?? -Infinity) || a.name.localeCompare(b.name, "ko");
    }
    if (sort === "name") return a.name.localeCompare(b.name, "ko");
    return (sb?.rep_count ?? 0) - (sa?.rep_count ?? 0);
  });

  return (
    <div className="space-y-5">
      {/* 탭. 정렬은 탭마다 다르므로 탭을 옮길 때 sort 를 버린다. 검색어는 남긴다. */}
      <nav className="flex flex-wrap gap-1 border-b border-line text-sm">
        {["", ...OFFICES.filter((o) => offices.includes(o))].map((o) => {
          const href = { pathname: "/", query: { ...(q && { q }), ...(o && { office: o }) } };
          const on = o === office;
          return (
            <Link
              key={o || "all"}
              href={href}
              className={`-mb-px border-b-2 px-3 py-2 ${
                on ? "border-foreground font-semibold" : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {o || "전체"}
              <span className="ml-1.5 text-xs font-normal text-muted">
                {o ? counts.get(o) ?? 0 : members.length}
              </span>
            </Link>
          );
        })}
      </nav>

      <form role="search" className="flex flex-wrap gap-2">
        <input type="hidden" name="office" value={office} />
        <label htmlFor="q" className="sr-only">이름 또는 지역구로 찾기</label>
        <input
          id="q"
          type="search"
          name="q"
          defaultValue={q}
          placeholder="이름 또는 지역구 (예: 강남, 홍길동)"
          className="min-w-40 flex-1 rounded-md border border-line bg-card px-3 py-2 text-base sm:text-sm"
        />
        {parties.length > 1 && (
          <select
            name="party"
            aria-label="정당"
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
        )}
        {/* 지역구/비례는 국회 개념이다. 다른 탭에서는 뜻이 없다. */}
        {office === "국회의원" && (
          <select
            name="elect"
            aria-label="지역구·비례"
            defaultValue={elect}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm"
          >
            <option value="">지역구+비례</option>
            <option value="지역구">지역구만</option>
            <option value="비례대표">비례대표만</option>
          </select>
        )}
        {allowed.length > 1 && (
          <select
            name="sort"
            aria-label="정렬"
            defaultValue={sort}
            className="rounded-md border border-line bg-card px-3 py-2 text-sm"
          >
            {allowed.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        )}
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          검색
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span>
          현직 <b className="text-foreground">{rows.length.toLocaleString("ko-KR")}</b>명
          {allowed.length > 1 && <> · {allowed.find(([k]) => k === sort)?.[1]}</>}
        </span>
        {/* 걸린 조건을 보이고 한 번에 지울 수 있게. 검색어가 남은 걸 모르고 '왜 몇 명뿐이지'
            에서 막힌다. */}
        {(q || party || elect) && (
          <>
            {[q && `'${q}'`, party, elect && `${elect}만`].filter(Boolean).map((t) => (
              <span key={t as string} className="rounded-full border border-line bg-card px-2 py-0.5 text-xs text-foreground">
                {t}
              </span>
            ))}
            <Link
              href={{ pathname: "/", query: { ...(office && { office }) } }}
              className="text-xs underline underline-offset-2 hover:text-foreground"
            >
              조건 지우기
            </Link>
          </>
        )}
      </div>
      {(sort === "attend" || sort === "asset") && (
        <p className="-mt-3 text-xs text-muted">
          {sort === "attend"
            ? "제22대 본회의 출석 ÷ 회의일수. 기록이 없는 사람은 뒤에 둡니다."
            : "가장 최근 공개된 순재산(국회의원은 국회공보, 단체장·교육감은 관보 — 국회의원 출신은 그 시절 신고일 수 있습니다). 아직 공개 전인 사람은 뒤에 둡니다."}{" "}
          <Link href={sort === "attend" ? "/rules#attendance" : "/rules#asset"} className="underline underline-offset-2">
            기준
          </Link>
        </p>
      )}
      {/* 22대 정원은 300명인데 현역 명부는 299명이다. 이유를 안 적으면 읽는
          사람이 '1명이 어디 갔지' 에서 막힌다. 국회의원 탭에서만 보인다 —
          단체장·교육감은 현역 명부를 주는 API 가 없어 공석을 알 수 없다. */}
      {!!vacancies.length && (office === "국회의원" || !office) && (
        <p className="-mt-3 text-xs text-muted">
          공석 {vacancies.length}곳 (
          {vacancies.map((v) => shortDistrict(`${v.sd_name} ${v.district}`)).join(", ")})
        </p>
      )}

      {!rows.length && (
        <div className="rounded-lg border border-line bg-card p-6 text-center text-sm">
          <p className="font-semibold">조건에 맞는 사람이 없습니다.</p>
          <p className="mt-1 text-muted">
            이름은 성까지, 지역구는 &lsquo;강남&rsquo; 처럼 일부만 넣어도 찾습니다.{" "}
            <Link href={{ pathname: "/", query: { ...(office && { office }) } }} className="underline underline-offset-2">
              조건 지우기
            </Link>
          </p>
        </div>
      )}

      {/* prefetch 를 끈다. 카드가 558개라 스크롤하면 Next 가 보이는 링크마다 RSC
          페이로드를 미리 받는다. 요청 수백 건이 사진과 대역폭을 두고 다툰다. */}
      <ul className="grid gap-2 sm:grid-cols-2">
        {rows.map((m) => {
          const s = statById.get(m.code);
          const r = recById.get(m.code);
          const mp = (m.office ?? "국회의원") === "국회의원";
          const term = termBy.get(`${m.code}|${m.office}`);
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
                    <span className="whitespace-nowrap text-base font-semibold">{m.name}</span>
                    {(m.office ?? "국회의원") === "국회의원" && (
                      <ElectBadge type={m.elect_type} />
                    )}
                    {/* 직위 배지는 직위가 섞인 '전체' 탭에서만. 한 직위 탭에서 모든 카드에
                        같은 배지가 반복되면 눈이 이름보다 배지로 간다. */}
                    {!office && (
                      <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${officeBadge(m.office)}`}>
                        {m.office ?? "국회의원"}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {[
                      lastPart(m.party),
                      shortDistrict(m.district),
                      // 단체장은 '그 직위 선수 · 국회 N선' 을 같이 적는다. 하나만
                      // 적으면 오세훈(시장 5선·국회 초선)이든 추미애(도지사 초선·
                      // 국회 6선)든 한쪽이 통째로 사라진다.
                      termText(m.office, termBy.get(`${m.code}|${m.office}`)?.wins, m.term_count),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {/* 국회의원 탭은 발의·표결로 정렬하고, 단체장·교육감 탭은 공약·득표율·
                        당선으로 정렬한다. 카드도 그 값을 보여야 왜 이 순서인지 보인다 —
                        지금 정렬 기준인 값은 테두리를 둘러 눈이 먼저 가게 한다.
                        단체장의 국회 기록은 상세 페이지에서 '국회의원 시절' 로 보여준다. */}
                    {(m.office ?? "국회의원") === "국회의원" && hasBills(s) ? (
                      <>
                        <Fig on={sort === "rep"} label="대표발의" value={s?.rep_count ?? 0} />
                        <Fig on={sort === "co"} label="공동발의" value={s?.co_count ?? 0} />
                        <Fig on={sort === "vote"} label="표결참여"
                             value={attendRate(s) == null ? "기록 없음" : `${attendRate(s)}%`} />
                      </>
                    ) : hasPledges(s) ? (
                      <>
                        <Fig on={sort === "pledge"} label="공약" value={`${s!.pledge_count}건`} />
                        {/* 정렬로 고를 수 있는 값은 카드에도 보여야 한다. 안 그러면
                            '득표율 높은 순' 을 골라도 왜 이 순서인지 알 수가 없다. */}
                        {term?.last_vote_rate != null && (
                          <Fig on={sort === "rate"} label="득표율" value={`${term.last_vote_rate}%`} />
                        )}
                        {!!term?.wins && <Fig on={sort === "wins"} label="당선" value={`${term.wins}회`} />}
                      </>
                    ) : (
                      <span>수집된 활동 기록 없음</span>
                    )}
                  </div>
                  {/* 공개 기록. 내 지역 카드와 같은 줄이다. 값이 없는 칸은 빼고, 겸직 불가·
                      사직 권고는 있을 때만 적는다. */}
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                    {mp && r?.days ? (
                      <Fig on={sort === "attend"} label="출석" value={`${pct(r.present ?? 0, r.days)}%`} />
                    ) : null}
                    <Fig on={sort === "asset"} label="순재산" value={r?.net_k != null ? eok(r.net_k) : "공개 전"} />
                    {mp && !!r?.trips && <Fig label="국외활동" value={r.trips} />}
                    {mp && !!r?.studies && <Fig label="연구용역" value={r.studies} />}
                    {!!r?.sidejob_flagged && (
                      <span className="text-red-700 dark:text-red-400">겸직 불가·사직 권고 {r.sidejob_flagged}건</span>
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

type Rec = {
  code: string; present: number | null; days: number | null; net_k: number | null;
  trips: number | null; studies: number | null; sidejob_flagged: number | null;
};

/** 천원 → '16.6억'. 카드 칸이 좁아 억 한 자리로 줄인다. */
const eok = (k: number) => `${(k / 100000).toFixed(1)}억`;

/** 카드의 수치 하나. on 이면 지금 정렬 기준이라 테두리를 두른다(색만으로 가르지 않는다). */
function Fig({ label, value, on }: { label: string; value: number | string; on?: boolean }) {
  return (
    <span className={on ? "rounded border border-foreground/40 px-1.5 py-px text-foreground" : ""}>
      {label} <b className="font-semibold text-foreground">{typeof value === "number" ? value.toLocaleString("ko-KR") : value}</b>
    </span>
  );
}

/** 비례대표만 표시한다. 지역구는 옆에 지역명이 이미 있어 배지가 중복이다. */
function ElectBadge({ type }: { type?: string | null }) {
  if (!type?.includes("비례")) return null;
  return (
    <span className="shrink-0 rounded bg-violet-600 px-1.5 py-0.5 text-xs font-medium text-white">
      비례
    </span>
  );
}

/** 사진이 없거나 못 불러오면 이름이 뒤에서 드러난다. 클라이언트 스크립트 없이 처리한다. */
export function Photo({ src, name }: { src?: string | null; name: string }) {
  return (
    <span className="relative grid h-14 w-12 shrink-0 place-items-center overflow-hidden rounded bg-line text-xs text-muted">
      {name.slice(-2)}
      {src && (
        <Image
          src={src}
          alt=""
          width={48}
          height={56}
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

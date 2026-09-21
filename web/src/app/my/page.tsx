import Link from "next/link";
import {
  db, hasBills, hasPledges, lastPart, partyColor, pct, shortDistrict,
  type Member, type MemberStats,
} from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "내 지역 대표",
  alternates: { canonical: "/my" },
  description:
    "우리 동네 국회의원·시도지사·구청장·교육감을 한 화면에서. 선거공보에 없는 지난 임기 기록을 봅니다.",
};

/** 선관위가 주는 시도·시군구. member.district 는 직위마다 모양이 달라 못 쓴다. */
type Area = {
  member_code: string;
  office: string;
  sd_name: string | null;
  wiw_name: string | null;
};

const OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"];

/** 2026년 지방선거에서 광주·전남이 통합됐다. 새 시도지사·교육감만 통합 이름으로 넘어가고
 *  국회의원·구청장은 옛 시도 이름 그대로라, 합치지 않으면 광주 주민이 자기 시도지사를 놓친다. */
const SD_MERGED: Record<string, string> = {
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};
const sido = (v: string | null) => (v ? SD_MERGED[v] ?? v : "");

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const { area = "" } = await searchParams;
  // 'sd|wiw'. 시군구 이름은 시도를 건너뛰면 겹친다 (중구가 여섯 곳, 광주시는 경기도에 있다).
  const [sd = "", wiw = ""] = area.split("|");

  // 셋 다 현직만이라 550행 안쪽이다. PostgREST 1000행 상한에 닿지 않는다.
  const [{ data: areas }, { data: members }, { data: stats }] = await Promise.all([
    db.from("member_area").select("member_code, office, sd_name, wiw_name"),
    db.from("member").select("*").eq("is_incumbent", true),
    db.from("member_stats").select("*").eq("is_incumbent", true),
  ]);

  const areaBy = new Map(((areas ?? []) as Area[]).map((a) => [a.member_code, a]));
  const statBy = new Map((stats ?? []).map((s: MemberStats) => [s.code, s]));

  // 시도 → 시군구 목록. 한 select 안에 optgroup 으로 넣어 시도를 따로 고르지 않게 한다.
  const byRegion = new Map<string, Set<string>>();
  for (const a of (areas ?? []) as Area[]) {
    // '전국' 은 비례대표다. 지역으로 찾는 화면에 넣을 자리가 없다.
    if (!a.sd_name || a.sd_name === "전국") continue;
    const k = sido(a.sd_name);
    if (!byRegion.has(k)) byRegion.set(k, new Set());
    if (a.wiw_name) byRegion.get(k)!.add(a.wiw_name);
  }
  const regions = [...byRegion].sort(([a], [b]) => a.localeCompare(b, "ko"));

  const picked = sd
    ? (members ?? []).filter((m: Member) => {
        const a = areaBy.get(m.code);
        if (!a || a.sd_name === "전국" || sido(a.sd_name) !== sd) return false;
        if (!wiw) return true;
        // 구시군의장은 시군구가 곧 관할이라 그대로 비교한다.
        if (a.office === "구시군의장") return a.wiw_name === wiw;
        // 시도지사·교육감은 시도 전체가 관할이라 시군구를 따지지 않는다.
        if (a.office !== "국회의원") return true;
        // 국회의원은 wiw_name 동등비교로는 안 된다. '군산시김제시부안군을' 처럼 한 지역구가
        // 여러 시를 묶으면 wiw_name 에는 김제시만 남아 군산시 주민이 자기 의원을 놓친다.
        return (m.district ?? "").includes(wiw);
      })
    : [];

  picked.sort(
    (a: Member, b: Member) =>
      OFFICE_ORDER.indexOf(a.office ?? "국회의원") - OFFICE_ORDER.indexOf(b.office ?? "국회의원") ||
      a.name.localeCompare(b.name, "ko"),
  );

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">내 지역 대표</h1>
        <p className="mt-1 text-sm text-muted">
          선거공보에는 다음 임기에 뭘 하겠다는 말만 있습니다. 지난 임기에 무엇을 했는지 봅니다.
        </p>
      </header>

      <form className="flex flex-wrap gap-2">
        <select
          name="area"
          defaultValue={area}
          className="min-w-52 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
        >
          <option value="">지역을 고르세요</option>
          {regions.map(([name, wiws]) => (
            <optgroup key={name} label={name}>
              <option value={`${name}|`}>{name} 전체</option>
              {[...wiws].sort((a, b) => a.localeCompare(b, "ko")).map((w) => (
                <option key={w} value={`${name}|${w}`}>
                  {w}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          찾기
        </button>
      </form>

      {!sd ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          선거공보 봉투에 적힌 지역을 고르면 그 지역의 국회의원·시도지사·구청장·교육감이 나옵니다.
        </p>
      ) : picked.length === 0 ? (
        <p className="rounded-lg border border-line bg-card p-6 text-sm text-muted">
          {wiw || sd} 에 해당하는 현직을 찾지 못했습니다.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted">
            {[sd, wiw].filter(Boolean).join(" ")} · {picked.length}명
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {picked.map((m: Member) => (
              <li key={m.code}>
                <Card m={m} s={statBy.get(m.code)} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            비례대표 의원은 지역구가 없어 여기서는 찾을 수 없습니다.{" "}
            <Link href="/" className="underline underline-offset-2">
              이름으로 검색
            </Link>
            하세요.
          </p>
        </>
      )}
    </div>
  );
}

function Card({ m, s }: { m: Member; s?: MemberStats }) {
  return (
    <Link
      href={`/m/${m.code}`}
      className="flex h-full gap-3 rounded-lg border border-line bg-card p-3 transition hover:border-muted"
    >
      <span className="w-1 shrink-0 rounded-full" style={{ background: partyColor(m.party) }} />
      {m.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.photo_url} alt="" loading="lazy" className="h-12 w-10 shrink-0 rounded object-cover" />
      ) : (
        <span className="grid h-12 w-10 shrink-0 place-items-center rounded bg-line text-xs text-muted">
          {m.name.slice(-2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap font-semibold">{m.name}</span>
          <span className="ml-auto shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">
            {m.office ?? "국회의원"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {[lastPart(m.party), shortDistrict(m.district)].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
          {hasBills(s) ? (
            <>
              <span>
                대표발의 <b className="text-foreground">{s!.rep_count}</b>
              </span>
              <span>
                표결참여{" "}
                <b className="text-foreground">{pct(s!.vote_total - s!.vote_absent, s!.vote_total)}%</b>
              </span>
            </>
          ) : hasPledges(s) ? (
            <span>
              공약 <b className="text-foreground">{s!.pledge_count}</b>건
            </span>
          ) : (
            <span>수집된 활동 기록 없음</span>
          )}
        </div>
      </div>
    </Link>
  );
}

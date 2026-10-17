import type { Metadata } from "next";
import Link from "@/lib/link";
import { Photo } from "../page";
import { AreaPicker } from "./picker";
import { pageOg } from "@/lib/site";
import { subscriptionOn } from "@/lib/subscription";
import {
  attendRate, districtArea, officeBadge, CARD_COLS, CARD_REC_COLS, CARD_STAT_COLS, db, eok, hasBills, hasPledges, lastPart, myPath, partyColor, pct, regionsOf, shortDistrict, sido,
  type Area, type CardRecord, type CardStats, type Member,
} from "@/lib/db";

export const revalidate = 3600;

const TITLE = "내 지역 대표";
const DESC = "우리 동네 국회의원·시도지사·구청장·교육감을 한 화면에서. 선거공보에 없는 지난 임기 기록과 출석·재산 같은 공개 기록을 봅니다.";

type SP = { sd?: string; wiw?: string; area?: string };

/** 주소에서 시도·시군구를 읽는다. area='sd|wiw' 는 예전 주소다. 시군구 이름은 시도를 건너뛰면
 *  겹치니(중구가 여섯 곳, 광주시는 경기도에 있다) 둘 다 있어야 한다. 그 시도에 없는 시군구면
 *  (손으로 고친 주소) 시도 전체로 둔다. 없는 시도면 둘 다 비운다. */
function pick(q: SP, regions: Record<string, string[]>) {
  const [aSd = "", aWiw = ""] = (q.area ?? "").split("|");
  const sd = sido(q.sd || aSd);
  if (!regions[sd]) return { sd: "", wiw: "" };
  const wiw = q.wiw || aWiw;
  return { sd, wiw: regions[sd].includes(wiw) ? wiw : "" };
}

// 지역을 고른 주소는 그 지역의 허브다. '송파구 국회의원' 으로 찾는 사람이 닿을 곳이
// 여기밖에 없는데, canonical 을 /my 하나로 묶어 두면 검색엔진이 지역 화면을 버린다.
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<SP> },
): Promise<Metadata> {
  // 본문과 같은 조회라 데이터 캐시를 같이 쓴다.
  const { data } = await db.from("member_area").select("member_code, office, sd_name, wiw_name");
  const { sd, wiw } = pick(await searchParams, regionsOf((data ?? []) as Area[]));
  if (!sd) {
    return { title: TITLE, alternates: { canonical: "/my" }, description: DESC, ...pageOg(`누렁소검은소 — ${TITLE}`, DESC, "/my") };
  }
  const place = wiw ? `${sd} ${wiw}` : sd;
  const title = `${place} 국회의원·단체장·교육감`;
  const description = `${place}의 국회의원·시도지사·구청장·교육감. 지난 임기 공약과 출석·표결·재산 같은 공개 기록을 원문 출처와 함께 봅니다.`;
  return { title, description, alternates: { canonical: myPath(sd, wiw) }, ...pageOg(title, description, myPath(sd, wiw)) };
}

const OFFICE_ORDER = ["국회의원", "구시군의장", "시도지사", "교육감"];

/** '서울 중구성동구갑' 에 '성동구' 가 있나. 시군구 이름이 시작하는 자리에서만 센다.
 *  collector/digest.py 의 in_district·resolve 가 같은 규칙이다 — 한쪽을 고치면 다른 쪽도. */
function inDistrict(district: string, wiw: string): boolean {
  for (let i = district.indexOf(wiw); i >= 0; i = district.indexOf(wiw, i + 1)) {
    if (i === 0 || " 시군구".includes(district[i - 1])) return true;
  }
  return false;
}

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const q = await searchParams;

  // 셋 다 현직만이라 550행 안쪽이다. PostgREST 1000행 상한에 닿지 않는다.
  const [{ data: areas }, { data: members }, { data: stats }, { data: records }] = await Promise.all([
    db.from("member_area").select("member_code, office, sd_name, wiw_name"),
    db.from("member").select(CARD_COLS).eq("is_incumbent", true),
    db.from("member_stats").select(CARD_STAT_COLS).eq("is_incumbent", true),
    // 출결·재산·겸직 등 공개 기록. 현직 한 사람당 한 줄이다(member_record).
    db.from("member_record").select(CARD_REC_COLS),
  ]);

  const areaBy = new Map(((areas ?? []) as Area[]).map((a) => [a.member_code, a]));
  const statBy = new Map((stats ?? []).map((s: CardStats) => [s.code, s]));
  const recBy = new Map(((records ?? []) as CardRecord[]).map((r) => [r.code, r]));

  // 시도 → 시군구 목록. 통째로 클라이언트에 넘겨 시도를 고르는 즉시 채운다.
  const regions = regionsOf((areas ?? []) as Area[]);
  const { sd, wiw } = pick(q, regions);

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
        // 다만 이름 경계에서만 잇는다 — 그냥 포함이면 '서구' 가 달서구·강서구에, '양주시' 가
        // 남양주시에 붙었다(실측 7건). 앞 글자가 없거나 공백이거나 앞 시군구 이름의 끝이어야 한다.
        return inDistrict(m.district ?? "", wiw);
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
        <h1 className="text-xl font-bold">{sd ? `${wiw ? `${sd} ${wiw}` : sd} 대표` : TITLE}</h1>
        <p className="mt-1 text-sm text-muted">
          선거공보에는 다음 임기에 뭘 하겠다는 말만 있습니다. 지난 임기에 무엇을 했는지, 출석·재산·겸직
          같은 공개 기록과 함께 봅니다.
        </p>
      </header>

      {/* 두 단계를 한 줄에 나란히 둔다. 한 select 에 229개를 넣으면 모바일 휠에서
          자기 시군구까지 한참 굴려야 해서 시도를 먼저 좁힌다. */}
      <AreaPicker byRegion={regions} sd={sd} wiw={wiw} />

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
          <p className="text-sm text-muted">
            {[sd, wiw].filter(Boolean).join(" ")} · <b className="text-foreground">{picked.length}</b>명
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {picked.map((m: Member) => (
              <li key={m.code}>
                <Card m={m} s={statBy.get(m.code)} r={recBy.get(m.code)} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            출석률·국외활동·연구용역·겸직은 제22대 국회 기록, 순재산은 가장 최근 공개분입니다.
            새로 취임한 단체장·교육감은 첫 재산 신고가 공개되기 전입니다.{" "}
            비례대표 의원은 지역구가 없어 여기서는 찾을 수 없습니다.{" "}
            <Link href="/" className="underline underline-offset-2">
              이름으로 검색
            </Link>
            하세요.
          </p>
          {/* 구독 신청. 자바스크립트 없이 도는 보통 폼이다 — 결과는 /subscription 이 보여 준다.
              지역은 위에서 고른 값 그대로 보내고, route 가 이 목록에 있는지 다시 본다.
              메일 키가 다 들어오기 전에는 보이지 않는다(subscriptionOn). */}
          {subscriptionOn() && (
            <form
              method="post"
              action="/api/subscription?do=subscribe"
              className="space-y-2 rounded-lg border border-line bg-card p-4"
            >
              <label htmlFor="sub-email" className="block text-sm font-medium">
                {[sd, wiw].filter(Boolean).join(" ")}의 공개 기록이 새로 들어온 주에 메일 받기
              </label>
              <input type="hidden" name="sd" value={sd} />
              <input type="hidden" name="wiw" value={wiw} />
              {/* 사람에게는 보이지 않는 칸. 채워 오면 봇으로 보고 받은 척만 한다. */}
              <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              <div className="flex flex-wrap gap-2">
                <input
                  id="sub-email"
                  type="email"
                  name="email"
                  required
                  maxLength={254}
                  placeholder="메일 주소"
                  className="min-w-60 flex-1 rounded-md border border-line bg-card px-3 py-2 text-sm"
                />
                <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
                  구독 신청
                </button>
              </div>
              <p className="text-xs text-muted">
                매주 월요일, 지난주에 새로 수집된 대표발의 법안·본회의 표결·출결·공약 판정을 보냅니다. 기록이 없는
                주에는 보내지 않습니다. 메일 주소·지역·신청과 확인 시각만 저장하고, 확인 메일의 링크를 눌러야
                시작합니다. 메일마다 해지 링크가 있습니다.
              </p>
            </form>
          )}
        </>
      )}
    </div>
  );
}

function Card({ m, s, r }: { m: Member; s?: CardStats; r?: CardRecord }) {
  const mp = (m.office ?? "국회의원") === "국회의원";
  const area = mp ? districtArea(m.district) : "";
  return (
    <Link
      href={`/m/${m.code}`}
      prefetch={false}
      className="flex h-full gap-3 rounded-lg border border-line bg-card p-3 transition hover:border-muted"
    >
      <span className="w-1 shrink-0 rounded-full" style={{ background: partyColor(m.party) }} />
      <Photo src={m.photo_url} name={m.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="whitespace-nowrap text-base font-semibold">{m.name}</span>
          <span className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium ${officeBadge(m.office)}`}>
            {m.office ?? "국회의원"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted">
          {[lastPart(m.party), shortDistrict(m.district)].filter(Boolean).join(" · ")}
        </p>
        {/* 한 구에 갑·을·병이 나란히 뜨는 화면이라, 자기 동이 어디인지 여기서
            갈라줘야 한다. 구 전체가 한 선거구인 곳은 값이 없다. */}
        {area && <p className="mt-0.5 text-xs leading-snug text-muted">{area}</p>}
        <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted">
          {/* 국회의원 탭은 발의·표결로 정렬하고, 단체장·교육감 탭은 공약·득표율·
              당선으로 정렬한다. 카드도 그 값을 보여야 왜 이 순서인지 보인다.
              단체장의 국회 기록은 상세 페이지에서 '국회의원 시절' 로 보여준다. */}
          {(m.office ?? "국회의원") === "국회의원" && hasBills(s) ? (
            <>
              <span>
                대표발의 <b className="text-foreground">{s!.rep_count}</b>
              </span>
              <span>
                표결참여{" "}
                <b className="text-foreground">
                  {attendRate(s) == null ? "기록 없음" : `${attendRate(s)}%`}
                </b>
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
        {/* 공개 기록. 의원 페이지 '한눈에 보기' 와 같은 값이다. 값이 없는 칸은 빼고,
            겸직 불가·사직 권고는 있을 때만 적는다(없음을 굳이 늘어놓지 않는다). */}
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
          {mp && r?.days ? (
            <span>
              출석 <b className="text-foreground">{pct(r.present ?? 0, r.days)}%</b>
            </span>
          ) : null}
          <span>
            순재산{" "}
            {r?.net_k != null ? <b className="text-foreground">{eok(r.net_k)}</b> : "공개 전"}
          </span>
          {mp && !!r?.trips && <span>국외활동 <b className="text-foreground">{r.trips}</b></span>}
          {mp && !!r?.studies && <span>연구용역 <b className="text-foreground">{r.studies}</b></span>}
          {!!r?.sidejob_flagged && (
            <span className="text-red-700 dark:text-red-400">겸직 불가·사직 권고 {r.sidejob_flagged}건</span>
          )}
        </div>
      </div>
    </Link>
  );
}

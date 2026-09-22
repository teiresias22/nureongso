import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  db, electionYear, hasBills, hasPledges, KIND_LABEL, lastPart, noteText,
  partyColor, pct, shortDistrict, termLabel,
  type Bill, type Candidacy, type Member, type MemberStats, type OfficeTerm, type Rival,
} from "@/lib/db";
import { SITE } from "@/lib/site";
import { CompareButton, ShareButton } from "./actions";

export const revalidate = 3600;

const PAGE = 50;

/** 처리 상태 필터. proc_result 는 '원안가결/수정가결/폐기/대안반영폐기...' 처럼
 *  값이 여러 가지라 접두 매칭이 아니라 의미 단위로 묶는다. */
const BILL_FILTERS = [
  { key: "", label: "전체" },
  { key: "passed", label: "가결" },
  { key: "pending", label: "계류" },
  { key: "dropped", label: "폐기·기타" },
] as const;

/** 공약 출처가 둘이라 섞으면 안 된다. 대표공약은 법정 상한이 있는 5~10건이고,
 *  선거공보는 후보가 낸 전체 공약이다. */
const PLEDGE_SOURCES = [
  {
    key: "공약서",
    title: "대표공약 (선거공약서)",
    note: "후보가 선거관리위원회에 제출한 선거공약서의 대표 공약입니다. 공직선거법상 게재 수가 제한돼 지방선거는 5개, 대통령선거는 10개까지만 실립니다.",
  },
  {
    key: "선거공보",
    title: "공약 (선거공보)",
    note: "후보가 유권자에게 배포한 선거공보에서 뽑은 공약입니다. AI 가 PDF 원문을 읽어 정리했습니다.",
  },
] as const;

/** 의원의 법안 목록. 건수는 member_stats 에서 따로 읽는다 — PostgREST 가 1000행에서 잘라서
 *  여기 길이를 세면 1000건 넘는 의원의 통계가 조용히 틀어진다. */
function bills(code: string, role: "rep" | "co", filter: string, page: number) {
  let q = db
    .from("member_bill")
    .select("bill_id,bill_no,name,committee,proposed_at,proc_result,proposer,detail_link",
            { count: "exact" })
    .eq("member_code", code)
    .eq("role", role);
  if (filter === "passed") q = q.like("proc_result", "%가결%");
  else if (filter === "pending") q = q.is("proc_result", null);
  else if (filter === "dropped") q = q.not("proc_result", "is", null).not("proc_result", "like", "%가결%");
  return q
    .order("proposed_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
}

type SP = { rep?: string; co?: string; repPage?: string; coPage?: string };

/** 이 서비스는 팜플랫에서 이름을 보고 검색해 들어오는 것으로 시작한다.
 *  558명이 레이아웃의 기본 제목 하나를 공유하면 그 경로가 막힌다. */
export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> },
): Promise<Metadata> {
  const { code } = await params;
  const [{ data: member }, { data: stats }] = await Promise.all([
    db.from("member").select("name, office, party, district").eq("code", code).maybeSingle(),
    db.from("member_stats").select("*").eq("code", code).maybeSingle(),
  ]);
  if (!member) return { title: "찾을 수 없는 사람" };

  const m = member as Pick<Member, "name" | "office" | "party" | "district">;
  const s = (stats ?? undefined) as MemberStats | undefined;
  const who = [m.office ?? "국회의원", lastPart(m.party), shortDistrict(m.district)]
    .filter(Boolean)
    .join(" ");

  // 검색 결과에서 클릭을 만드는 건 홍보 문구가 아니라 수치다.
  const facts: string[] = [];
  if (hasBills(s)) {
    facts.push(`대표발의 ${s!.rep_count}건(가결 ${s!.rep_passed})`, `공동발의 ${s!.co_count}건`);
  }
  if (hasPledges(s)) facts.push(`공약 ${s!.pledge_count}건`);

  const title = `${m.name} · ${who}`;
  const description = facts.length
    ? `${title}. ${facts.join(" · ")}. 공약과 의정활동 기록을 원문 출처와 함께 봅니다.`
    : `${title}. 공약과 활동 기록을 원문 출처와 함께 봅니다.`;

  return {
    title,
    description,
    // 법안 목록 필터·페이지가 쿼리로 붙는다. canonical 이 없으면
    // ?rep=passed&repPage=3 같은 조합이 전부 따로 색인된다.
    alternates: { canonical: `/m/${code}` },
    openGraph: { title, description, type: "profile", url: `/m/${code}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function MemberPage({
  params, searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<SP>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const repFilter = sp.rep ?? "";
  const coFilter = sp.co ?? "";
  const repPage = Math.max(1, Number(sp.repPage) || 1);
  const coPage = Math.max(1, Number(sp.coPage) || 1);

  const [
    { data: member },
    { data: stats },
    { data: repBills, count: repTotal },
    { data: coBills, count: coTotal },
    { data: candidacies },
    { data: terms },
    { data: pledges },
  ] = await Promise.all([
    db.from("member").select("*").eq("code", code).maybeSingle(),
    db.from("member_stats").select("*").eq("code", code).maybeSingle(),
    bills(code, "rep", repFilter, repPage),
    bills(code, "co", coFilter, coPage),
    db.from("candidacy").select("*").eq("member_code", code).order("election_id", { ascending: false }),
    db.from("member_office_term").select("*").eq("member_code", code),
    db
      .from("pledge")
      .select(
        "id, title, body, category, election_id, source, kinds, pledge_status(status, decided_by, note), pledge_evidence(kind, ref_id, summary, score)",
      )
      .eq("member_code", code)
      .order("order_no"),
  ]);

  if (!member) notFound();
  const m = member as Member;

  // 같은 선거·같은 지역구에 나온 다른 후보들. '누구와 붙어서 이겼나' 가 득표율만큼 중요하다.
  // election_id 와 district 를 각각 in 으로 좁힌 뒤 짝이 맞는 것만 남긴다. 둘을 짝지어
  // 거르는 or(and(...)) 필터는 지역구 이름에 따옴표·괄호가 섞이면 깨진다.
  const runs = (candidacies ?? []) as Candidacy[];
  const { data: rivalRows } = runs.length
    ? await db
        .from("candidacy")
        .select("id, election_id, sg_typecode, sd_name, district, name, party, giho, vote_rate, elected, member_code")
        .in("election_id", [...new Set(runs.map((c) => c.election_id))])
        .in("district", [...new Set(runs.map((c) => c.district).filter(Boolean))] as string[])
    : { data: [] };
  // 네 가지를 다 맞춰야 한 선거구가 된다.
  // - sg_typecode: 지방선거는 시도지사·교육감·교육의원이 같은 날 같은 '강원도' 에서
  //   치러져서, 선거일과 지역만 맞추면 교육감 후보가 도지사 경쟁자로 섞인다.
  // - sd_name: '남구' 는 광주·대구·부산·울산에 다 있다. 시도를 안 보면 광주 남구청장
  //   김병내(무투표당선)에게 전국의 남구 후보 8명이 경쟁자로 붙었다. 동구·서구·중구·
  //   북구도 같고, 국회의원까지 합쳐 현직 57명이 이 상태였다.
  const rivalsOf = (c: Candidacy) =>
    ((rivalRows ?? []) as Rival[])
      .filter((r) => r.election_id === c.election_id && r.sg_typecode === c.sg_typecode
                     && r.sd_name === c.sd_name && r.district === c.district && r.id !== c.id)
      .sort((a, b) => Number(b.elected) - Number(a.elected) || (a.giho ?? "").localeCompare(b.giho ?? ""));
  const s: MemberStats = stats ?? {
    code,
    rep_count: 0, co_count: 0, rep_passed: 0, rep_pending: 0,
    vote_total: 0, vote_yes: 0, vote_no: 0, vote_blank: 0, vote_absent: 0,
    pledge_count: 0, pledge_done: 0, pledge_judged: 0,
    pledge_law: 0, pledge_law_filed: 0, pledge_law_passed: 0,
  };
  const attended = s.vote_total - s.vote_absent;
  const showBills = hasBills(s);
  // terms·term_count·committees·elect_type 는 국회 전용 필드다. 국회의원 출신
  // 단체장에게 그대로 보이면 지금 그 직위의 정보로 오해된다.
  const isMP = (m.office ?? "국회의원") === "국회의원";
  // 국회의원은 열린국회정보의 선수를, 나머지는 선관위 당선 횟수를 쓴다.
  const term = ((terms ?? []) as OfficeTerm[]).find((t) => t.office === m.office);
  const showPledges = hasPledges(s);
  // 이행 판정을 아직 한 건도 안 했다. 이때 0% 를 보이면 '아무것도 안 지켰다' 로 읽힌다.
  const judged = (pledges ?? []).some((p) => p.pledge_status);
  // 공약이 실제로 있는 선거만, 최근 순. 첫 번째가 이번 임기다.
  const pledgeElections = [...new Set((pledges ?? []).map((p) => p.election_id as string))]
    .filter(Boolean)
    .sort()
    .reverse();

  // 구글이 이 페이지를 '인물' 로 인식해야 이름 검색에 걸린다. 라이브러리 없이 객체 하나.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: m.name,
    jobTitle: m.office ?? "국회의원",
    affiliation: lastPart(m.party) || undefined,
    image: m.photo_url || undefined,
    url: `${SITE}/m/${code}`,
  };

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="flex items-center gap-2">
        <Link href="/" className="text-xs text-muted hover:underline">
          ← 전체 목록
        </Link>
        <div className="ml-auto flex gap-1.5">
          <ShareButton title={`${m.name} · ${m.office ?? "국회의원"}`} />
          {/* 비교는 국회의원끼리만 한다. 단체장·교육감은 견줄 숫자가 공약 건수뿐이다. */}
          {isMP && <CompareButton code={code} name={m.name} />}
        </div>
      </div>

      <header className="flex gap-4 rounded-lg border border-line bg-card p-4">
        <span className="w-1.5 rounded-full" style={{ background: partyColor(m.party) }} />
        {m.photo_url && (
          <Image
            src={m.photo_url}
            alt=""
            width={80}
            height={96}
            priority
            className="h-24 w-20 rounded object-cover"
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{m.name}</h1>
            {isMP && m.elect_type && (
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  m.elect_type.includes("비례")
                    ? "bg-violet-600 text-white"
                    : "border border-line text-muted"
                }`}
              >
                {m.elect_type}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[
              m.office,
              lastPart(m.party),
              lastPart(m.district),
              // 국회 선수는 국회의원일 때만. 단체장에게 붙으면 그 직위의 선수로 오해된다.
              isMP
                ? m.term_count && m.terms
                  ? `${m.term_count} (${m.terms})`
                  : m.term_count
                : // 단체장·교육감은 국회 선수가 없다. 그 직위로 몇 번 당선됐는지를 센다.
                  termLabel(term?.wins),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {isMP && m.committees && (
            <p className="mt-1 text-xs text-muted">{m.committees}</p>
          )}
          {term?.last_vote_rate != null && (
            <p className="mt-1 text-xs text-muted">
              {electionYear(term.last_election)}년 당선 · 득표율{" "}
              <b className="text-foreground">{term.last_vote_rate}%</b>
              {term.wins > 1 && (
                <> · {electionYear(term.first_election)}년부터 {term.wins}회 당선</>
              )}
            </p>
          )}
        </div>
      </header>

      {/* 단체장에게 붙은 발의·표결은 지금 직위의 일이 아니라 국회의원 시절 기록이다.
          안 적으면 '부산시장 전재수 · 본회의 표결 참여 46%' 가 시장 일로 읽힌다.
          숨기지는 않는다 — 단체장 임기는 잴 데이터가 없고, 그 사람의 가장 최근
          측정 가능한 임기가 국회의원 임기다. 그게 이 서비스가 묻는 '지난 임기' 다. */}
      {!isMP && showBills && (
        <p className="rounded-lg border border-line bg-card px-4 py-2 text-xs text-muted">
          아래 발의·표결은 <b className="text-foreground">국회의원 시절</b> 기록입니다
          {m.terms && ` (${m.terms})`}. {m.office ?? "현직"}으로서 한 일은 공약으로 봅니다.
        </p>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {showPledges && (
          <>
            <Stat label="공약" value={s.pledge_count} unit="건" />
            {/* 이행률은 해석이고 발의·가결은 사실이다. 사실을 먼저 보여준다. */}
            {s.pledge_law > 0 ? (
              <Stat
                label="법률로 재는 공약"
                value={s.pledge_law}
                unit="건"
                sub={`발의 ${s.pledge_law_filed} · 통과 ${s.pledge_law_passed}`}
              />
            ) : (
              <Stat
                label="공약 이행"
                value={judged ? pct(s.pledge_done, s.pledge_count) : null}
                unit="%"
                sub={judged ? `완료 ${s.pledge_done}/${s.pledge_count}` : "아직 판정하지 않음"}
              />
            )}
          </>
        )}
        {showBills && (
          <>
            <Stat label="대표발의" value={s.rep_count} unit="건" />
            <Stat label="공동발의" value={s.co_count} unit="건" />
            <Stat
              label="대표발의 가결률"
              value={pct(s.rep_passed, s.rep_count)}
              unit="%"
              sub={`가결 ${s.rep_passed} · 계류 ${s.rep_pending}`}
            />
            {/* 표결 기록이 없으면 칸을 비운다. 0% 로 두면 '한 번도 안 나왔다' 로
                읽히는데, 임기 중 들어온 의원은 국회 표결 API 명부에 아예 없다. */}
            {s.vote_total > 0 && (
              <Stat
                label="본회의 표결 참여"
                value={pct(attended, s.vote_total)}
                unit="%"
                sub={`${attended}/${s.vote_total}회`}
              />
            )}
          </>
        )}
      </section>

      {s.vote_total > 0 && (
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">표결 성향</h2>
          <div className="mt-2 flex gap-4 text-sm text-muted">
            {([["찬성", s.vote_yes], ["반대", s.vote_no], ["기권", s.vote_blank], ["불참", s.vote_absent]] as const).map(
              ([k, v]) => (
                <span key={k}>
                  {k} <b className="text-foreground">{v}</b>
                </span>
              ),
            )}
          </div>
        </section>
      )}

      <Section title="출마 이력" count={runs.length}>
        {runs.length ? (
          <ul className="divide-y divide-line">
            {runs.map((c) => {
              const rivals = rivalsOf(c);
              return (
                <li key={c.id}>
                 <Fold
                  open={rivals.length > 0}
                  hint={`후보 ${rivals.length}명`}
                  head={
                  <span className="flex justify-between gap-3 px-4 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      {[c.office, c.district, c.party].filter(Boolean).join(" · ")}
                      <span className="ml-2 text-xs text-muted">
                        {electionYear(c.election_id) || c.election_id}
                      </span>
                    </span>
                    <span className={c.elected ? "shrink-0 font-semibold" : "shrink-0 text-muted"}>
                      {c.vote_rate != null && `${c.vote_rate}% `}
                      {/* 당선인데 득표율이 없는 건 두 경우뿐이다. 비례대표는 정당 명부로
                          뽑혀 개인 득표가 아예 없고, 단독 출마는 개표를 하지 않는다.
                          '0%' 로 보이면 거짓말이므로 이유를 적는다. */}
                      {c.elected && c.vote_rate == null
                        ? c.district === "비례대표" ? "명부 당선" : "무투표당선"
                        : c.elected ? "당선" : "낙선"}
                    </span>
                  </span>
                  }
                 >
                    <div className="px-4 pb-2">
                      <ul className="space-y-0.5">
                        {rivals.map((r) => (
                          <li key={r.id} className="flex gap-2 text-xs text-muted">
                            <span
                              className="mt-1 h-2 w-2 shrink-0 rounded-full"
                              style={{ background: partyColor(r.party) }}
                            />
                            <span className="min-w-0 truncate">
                              {r.giho && <span className="mr-1">기호 {r.giho}</span>}
                              {/* 이 서비스에 페이지가 있는 사람만 링크한다 (당선 이력이 있는 사람) */}
                              {r.member_code ? (
                                <Link
                                  href={`/m/${r.member_code}`}
                                  className="text-foreground underline underline-offset-2"
                                >
                                  {r.name}
                                </Link>
                              ) : (
                                <b className="text-foreground">{r.name}</b>
                              )}
                              <span className="ml-1">{lastPart(r.party)}</span>
                            </span>
                            <span className="ml-auto flex shrink-0 gap-2">
                              <span>
                                {r.vote_rate != null ? `${r.vote_rate}%` : ""}
                                {r.elected ? " 당선" : ""}
                              </span>
                              {/* 같은 선거구에서 맞붙은 사람이 비교 상대로 가장
                                  자연스럽다. 드롭다운에서 558명 중 찾을 필요가 없다. */}
                              {r.member_code && isMP && c.sg_typecode === "2" && (
                                <Link
                                  href={`/compare?a=${code}&b=${r.member_code}`}
                                  className="underline underline-offset-2 hover:text-foreground"
                                >
                                  비교
                                </Link>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-[11px] text-muted">
                        득표율은 선관위 개표 정보의 득표수 ÷ 유효투표수입니다. 등록 후
                        사퇴한 후보는 개표에 집계되지 않아 비어 있습니다.
                      </p>
                    </div>
                 </Fold>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">아직 출마 이력이 없습니다.</p>
        )}
      </Section>

      {/* 선거별로 먼저 나눈다. N선 의원의 지난 임기 공약이 이번 임기 공약과 섞이면
          '지난 임기에 약속한 걸 지켰나' 라는 이 서비스의 질문 자체가 성립하지 않는다. */}
      {pledgeElections.map((eid) => {
        const run = runs.find((c) => c.election_id === eid);
        const isCurrent = eid === pledgeElections[0];
        return PLEDGE_SOURCES.map(({ key, title, note }) => {
        const list = (pledges ?? []).filter(
          (p) => p.election_id === eid && (p.source ?? "선거공보") === key,
        );
        if (!list.length) return null;
        const when = [
          electionYear(eid) ? `${electionYear(eid)}년` : eid,
          run && !isCurrent ? [run.office, lastPart(run.district)].filter(Boolean).join(" ") : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Section
            key={`${eid}-${key}`}
            // 지난 임기가 여럿인 사람이 있다. 전재수는 2020·2016 선거가 둘 다
            // 있어서 '지난 임기 공약' 이 두 개로 나온다. 접혀 있으면 안내문의
            // 연도가 안 보이므로 제목에 붙여 구별한다.
            title={`${isCurrent ? "이번 임기" : `지난 임기(${electionYear(eid)})`} ${title}`}
            count={list.length}
            // 펼쳐 두는 건 '이번 임기 대표공약' 하나다. 수십 건짜리 선거공보 공약과
            // 지난 임기까지 다 펼치면 화면이 공약 목록으로만 채워진다.
            fold={!(isCurrent && key === "공약서")}
          >
            <p className="border-b border-line bg-background/40 px-4 py-2 text-xs text-muted">
              <b className="text-foreground">{when}</b> 선거 · {note}{" "}
              <Link href="/rules" className="underline underline-offset-2">
                판정 기준
              </Link>
            </p>
            <ul className="divide-y divide-line">
            {list.map((p) => {
              const st = p.pledge_status as unknown as
                { status: string; decided_by: string; note: string | null } | null;
              const ev = (p.pledge_evidence ?? []) as unknown as {
                kind: string; ref_id: string; summary: string | null; score: number | null;
              }[];
              return (
                <li key={p.id}>
                  <Fold
                    open={!!p.body || ev.length > 0}
                    hint="원문"
                    head={
                      <span className="flex gap-3 px-4 py-3 text-sm">
                        {st ? (
                          <StatusBadge status={st.status} auto={st.decided_by !== "reviewer"} />
                        ) : (
                          <span className="mt-0.5 shrink-0 text-[11px] text-muted">미판정</span>
                        )}
                        <span className="min-w-0">
                          <span className="block text-[11px] text-muted">
                            {[p.category, ...(p.kinds ?? []).map((k: string) => KIND_LABEL[k] ?? k)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span className="block font-medium">{p.title}</span>
                          {st?.note && (
                            <span className="mt-0.5 block text-xs text-muted">{noteText(st.note)}</span>
                          )}
                        </span>
                      </span>
                    }
                  >
                    <div className="space-y-1.5 px-4 pb-3 pl-[4.25rem] text-xs">
                      {ev.map((e) => (
                        <div key={e.ref_id}>
                          <Link
                            href={`/bill/${e.ref_id}`}
                            className="text-foreground underline underline-offset-2"
                          >
                            근거 법안
                          </Link>
                          {e.summary && <span className="ml-1 text-muted">{e.summary}</span>}
                        </div>
                      ))}
                      {p.body && <p className="whitespace-pre-wrap text-muted">{p.body}</p>}
                    </div>
                  </Fold>
                </li>
              );
            })}
            </ul>
          </Section>
        );
        });
      })}

      {!pledges?.length && (
        <Section title="공약" count={0}>
          <p className="px-4 py-3 text-sm text-muted">아직 공약 데이터가 없습니다.</p>
        </Section>
      )}

      {showBills && (
        <>
          <Section title="대표발의 법안" count={s.rep_count}>
            <BillList
              bills={(repBills ?? []) as Bill[]}
              total={repTotal ?? 0}
              from={code}
              param="rep"
              pageParam="repPage"
              filter={repFilter}
              page={repPage}
              keep={{ co: coFilter, coPage: String(coPage) }}
            />
          </Section>

          <Section title="공동발의 법안" count={s.co_count}>
            <BillList
              bills={(coBills ?? []) as Bill[]}
              total={coTotal ?? 0}
              from={code}
              param="co"
              pageParam="coPage"
              filter={coFilter}
              page={coPage}
              keep={{ rep: repFilter, repPage: String(repPage) }}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit, sub }:
  { label: string; value: number | null; unit: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {value === null ? (
          <span className="text-base font-normal text-muted">미집계</span>
        ) : (
          <>
            {value}
            <span className="ml-0.5 text-sm font-normal text-muted">{unit}</span>
          </>
        )}
      </p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

/** fold 를 주면 접힌 상태로 시작한다. 제목줄 전체가 누르는 자리다.
 *  details/summary 라 스크립트가 필요 없고, 검색엔진은 접힌 내용도 읽는다. */
function Section({
  title, count, children, fold,
}: { title: string; count: number; children: React.ReactNode; fold?: boolean }) {
  const head = (
    <>
      {title} <span className="font-normal text-muted">{count}</span>
    </>
  );
  if (!fold) {
    return (
      <section className="overflow-hidden rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">{head}</h2>
        {children}
      </section>
    );
  }
  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm font-semibold marker:content-none hover:bg-background/40 group-open:border-b group-open:border-line [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">{head}</span>
        <span className="ml-auto shrink-0 text-xs font-normal text-muted group-open:hidden">펼치기</span>
        <span className="ml-auto hidden shrink-0 text-xs font-normal text-muted group-open:inline">접기</span>
      </summary>
      {children}
    </details>
  );
}

/** 카드 한 장을 접는다. 열 것이 없으면 그냥 감싸기만 한다.
 *
 *  summary 가 카드 본문을 통째로 감싸므로 어디를 눌러도 열린다. 예전에는 '공약 원문
 *  보기' 라는 11px 글씨만 누를 수 있어 손가락으로는 맞히기 어려웠다.
 *
 *  summary 안에 <p>·<ul> 같은 블록 태그를 넣으면 브라우저가 summary 를 닫아버려
 *  레이아웃이 깨진다. 그래서 접히는 머리 부분은 span + block 클래스로만 쓴다. */
function Fold({
  open: canOpen, hint, head, children,
}: { open: boolean; hint: string; head: React.ReactNode; children: React.ReactNode }) {
  if (!canOpen) return <>{head}</>;
  return (
    <details className="group">
      <summary className="flex cursor-pointer items-start marker:content-none hover:bg-background/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{head}</span>
        <span className="shrink-0 py-2 pr-3 text-[11px] text-muted group-open:hidden">+{hint}</span>
        <span className="hidden shrink-0 py-2 pr-3 text-[11px] text-muted group-open:inline">접기</span>
      </summary>
      {children}
    </details>
  );
}

function StatusBadge({ status, auto }: { status?: string; auto?: boolean }) {
  const color =
    status === "완료" ? "bg-green-600" : status === "진행" ? "bg-amber-500" : status === "미착수" ? "bg-stone-400" : "bg-stone-300";
  return (
    <span className="shrink-0">
      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] text-white ${color}`}>
        {status ?? "판단불가"}
      </span>
      {auto && <span className="ml-1 text-[10px] text-muted">자동</span>}
    </span>
  );
}

function BillList({
  bills, total, from, param, pageParam, filter, page, keep,
}: {
  bills: Bill[]; total: number; from: string;
  param: string; pageParam: string; filter: string; page: number;
  keep: Record<string, string>;
}) {
  // 필터를 바꾸면 그 목록의 쪽 번호만 1로 되돌리고, 다른 목록의 상태는 유지한다.
  const link = (next: Record<string, string>) => {
    const q = new URLSearchParams({ ...keep, [param]: filter, [pageParam]: String(page), ...next });
    for (const [k, v] of [...q]) if (!v || v === "1") q.delete(k);
    const qs = q.toString();
    return qs ? `?${qs}#${param}` : `#${param}`;
  };
  const last = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div id={param}>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
        {BILL_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={link({ [param]: f.key, [pageParam]: "1" })}
            className={`rounded px-2 py-1 text-xs ${
              filter === f.key ? "bg-foreground text-background" : "text-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
        <span className="ml-auto text-xs text-muted">{total.toLocaleString()}건</span>
      </div>

      {!bills.length ? (
        <p className="px-4 py-3 text-sm text-muted">해당하는 법안이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line">
          {bills.map((b) => (
            <li
              key={b.bill_id}
              className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm"
            >
              {/* from 을 달아 법안 상세에서 이 의원 페이지로 돌아올 수 있게 한다 */}
              <Link
                href={`/bill/${b.bill_id}?from=${from}`}
                className="min-w-0 truncate hover:underline"
              >
                {b.name}
              </Link>
              <span className="shrink-0 text-xs text-muted">
                {b.proposed_at} · {b.proc_result ?? "계류"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {last > 1 && (
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs">
          {page > 1 ? (
            <Link href={link({ [pageParam]: String(page - 1) })} className="text-muted hover:underline">
              ← 이전
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            {page} / {last}
          </span>
          {page < last ? (
            <Link href={link({ [pageParam]: String(page + 1) })} className="text-muted hover:underline">
              다음 →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}

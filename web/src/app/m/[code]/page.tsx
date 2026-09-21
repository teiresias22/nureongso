import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  db, electionYear, hasBills, hasPledges, KIND_LABEL, lastPart, noteText,
  partyColor, pct, shortDistrict, SITE, termLabel,
  type Bill, type Member, type MemberStats, type OfficeTerm,
} from "@/lib/db";

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
    key: "선거공보",
    title: "공약 (선거공보)",
    note: "후보가 유권자에게 배포한 선거공보에서 뽑은 공약입니다. AI 가 PDF 원문을 읽어 정리했습니다.",
  },
  {
    key: "공약서",
    title: "대표공약 (선거공약서)",
    note: "후보가 선거관리위원회에 제출한 선거공약서의 대표 공약입니다. 공직선거법상 게재 수가 제한돼 지방선거는 5개, 대통령선거는 10개까지만 실립니다.",
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

  return { title, description, openGraph: { title, description, type: "profile" } };
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
      <div className="flex items-center justify-between">
        <Link href="/" className="text-xs text-muted hover:underline">
          ← 전체 목록
        </Link>
        <Link href={`/compare?a=${code}`} className="text-xs text-muted hover:underline">
          다른 사람과 비교 →
        </Link>
      </div>

      <header className="flex gap-4 rounded-lg border border-line bg-card p-4">
        <span className="w-1.5 rounded-full" style={{ background: partyColor(m.party) }} />
        {m.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photo_url} alt="" className="h-24 w-20 rounded object-cover" />
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
            <Stat
              label="본회의 표결 참여"
              value={pct(attended, s.vote_total)}
              unit="%"
              sub={`${attended}/${s.vote_total}회`}
            />
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

      {PLEDGE_SOURCES.map(({ key, title, note }) => {
        const list = (pledges ?? []).filter((p) => (p.source ?? "선거공보") === key);
        if (!list.length) return null;
        return (
          <Section key={key} title={title} count={list.length}>
            <p className="border-b border-line bg-background/40 px-4 py-2 text-xs text-muted">
              {note}{" "}
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
                <li key={p.id} className="flex gap-3 px-4 py-3 text-sm">
                  {st ? (
                    <StatusBadge status={st.status} auto={st.decided_by !== "reviewer"} />
                  ) : (
                    <span className="mt-0.5 shrink-0 text-[11px] text-muted">미판정</span>
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted">
                      {[p.category, ...(p.kinds ?? []).map((k: string) => KIND_LABEL[k] ?? k)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="font-medium">{p.title}</p>
                    {st?.note && (
                      <p className="mt-0.5 text-xs text-muted">{noteText(st.note)}</p>
                    )}
                    {ev.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {ev.map((e) => (
                          <li key={e.ref_id} className="text-xs">
                            <Link
                              href={`/bill/${e.ref_id}`}
                              className="text-foreground underline underline-offset-2"
                            >
                              근거 법안
                            </Link>
                            {e.summary && <span className="ml-1 text-muted">{e.summary}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {p.body && (
                      // 공약 본문은 목표·이행방법·재원조달까지 담긴 긴 원문이라 접어 둔다.
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted">
                          공약 원문 보기
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted">{p.body}</p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
            </ul>
          </Section>
        );
      })}

      {!pledges?.length && (
        <Section title="공약" count={0}>
          <p className="px-4 py-3 text-sm text-muted">아직 공약 데이터가 없습니다.</p>
        </Section>
      )}

      <Section title="출마 이력" count={candidacies?.length ?? 0}>
        {candidacies?.length ? (
          <ul className="divide-y divide-line">
            {candidacies.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {[c.office, c.district, c.party].filter(Boolean).join(" · ")}
                  <span className="ml-2 text-xs text-muted">{c.election_id}</span>
                </span>
                <span className={c.elected ? "font-semibold" : "text-muted"}>
                  {c.vote_rate != null && `${c.vote_rate}% `}
                  {c.elected ? "당선" : "낙선"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">아직 출마 이력이 없습니다.</p>
        )}
      </Section>

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

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-card">
      <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted">{count}</span>
      </h2>
      {children}
    </section>
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

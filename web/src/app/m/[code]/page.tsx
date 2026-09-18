import Link from "next/link";
import { notFound } from "next/navigation";
import {
  db, hasBills, hasPledges, lastPart, partyColor, pct,
  type Bill, type Member, type MemberStats,
} from "@/lib/db";

export const revalidate = 3600;

const MAX = 50;

/** 의원의 법안 목록. 건수는 member_stats 에서 따로 읽는다 — PostgREST 가 1000행에서 잘라서
 *  여기 길이를 세면 1000건 넘는 의원의 통계가 조용히 틀어진다. */
const bills = (code: string, role: "rep" | "co") =>
  db
    .from("member_bill")
    .select("bill_id,bill_no,name,committee,proposed_at,proc_result,proposer,detail_link")
    .eq("member_code", code)
    .eq("role", role)
    .order("proposed_at", { ascending: false })
    .limit(MAX);

export default async function MemberPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const [
    { data: member },
    { data: stats },
    { data: repBills },
    { data: coBills },
    { data: candidacies },
    { data: pledges },
  ] = await Promise.all([
    db.from("member").select("*").eq("code", code).maybeSingle(),
    db.from("member_stats").select("*").eq("code", code).maybeSingle(),
    bills(code, "rep"),
    bills(code, "co"),
    db.from("candidacy").select("*").eq("member_code", code).order("election_id", { ascending: false }),
    db
      .from("pledge")
      .select("id, title, body, category, election_id, pledge_status(status, decided_by)")
      .eq("member_code", code)
      .order("order_no"),
  ]);

  if (!member) notFound();
  const m = member as Member;
  const s: MemberStats = stats ?? {
    code,
    rep_count: 0, co_count: 0, rep_passed: 0, rep_pending: 0,
    vote_total: 0, vote_yes: 0, vote_no: 0, vote_blank: 0, vote_absent: 0,
    pledge_count: 0, pledge_done: 0,
  };
  const attended = s.vote_total - s.vote_absent;
  const showBills = hasBills(s);
  const showPledges = hasPledges(s);

  return (
    <div className="space-y-6">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header className="flex gap-4 rounded-lg border border-line bg-card p-4">
        <span className="w-1.5 rounded-full" style={{ background: partyColor(m.party) }} />
        {m.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photo_url} alt="" className="h-24 w-20 rounded object-cover" />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{m.name}</h1>
            {m.elect_type && (
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
              m.district,
              m.term_count && m.terms ? `${m.term_count} (${m.terms})` : m.term_count,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {m.committees && <p className="mt-1 text-xs text-muted">{m.committees}</p>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {showPledges && (
          <>
            <Stat label="대표공약" value={s.pledge_count} unit="건" sub="선거공약서 기재" />
            <Stat
              label="대표공약 이행"
              value={pct(s.pledge_done, s.pledge_count)}
              unit="%"
              sub={`완료 ${s.pledge_done}/${s.pledge_count}`}
            />
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

      <Section title="대표공약" count={pledges?.length ?? 0}>
        {pledges?.length ? (
          <>
            <p className="border-b border-line bg-background/40 px-4 py-2 text-xs text-muted">
              후보가 선거공약서에 올린 대표 공약입니다. 공직선거법상 게재 수가 제한돼
              지방선거는 5개, 대통령선거는 10개까지만 실립니다.{" "}
              <b className="text-foreground">후보의 전체 공약이 아닙니다.</b> 전체는 선거공보에 있습니다.
            </p>
            <ul className="divide-y divide-line">
            {pledges.map((p) => {
              const st = (p.pledge_status as unknown as { status: string; decided_by: string } | null);
              return (
                <li key={p.id} className="flex gap-3 px-4 py-3 text-sm">
                  <StatusBadge status={st?.status} auto={st?.decided_by !== "reviewer"} />
                  <div className="min-w-0">
                    {p.category && <p className="text-[11px] text-muted">{p.category}</p>}
                    <p className="font-medium">{p.title}</p>
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
          </>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">
            {m.office === "국회의원"
              ? "국회의원은 선거공약서 제출 대상이 아니라 선관위 공약 API 에 자료가 없습니다. 선거공보 PDF 를 따로 수집해야 합니다."
              : "아직 공약 데이터가 없습니다."}
          </p>
        )}
      </Section>

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
            <BillList bills={(repBills ?? []) as Bill[]} total={s.rep_count} />
          </Section>

          <Section title="공동발의 법안" count={s.co_count}>
            <BillList bills={(coBills ?? []) as Bill[]} total={s.co_count} />
          </Section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit, sub }: { label: string; value: number; unit: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {value}
        <span className="ml-0.5 text-sm font-normal text-muted">{unit}</span>
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

function BillList({ bills, total }: { bills: Bill[]; total: number }) {
  if (!bills.length) return <p className="px-4 py-3 text-sm text-muted">없습니다.</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {bills.map((b) => (
          <li key={b.bill_id} className="flex items-baseline justify-between gap-3 px-4 py-2 text-sm">
            <Link href={`/bill/${b.bill_id}`} className="min-w-0 truncate hover:underline">
              {b.name}
            </Link>
            <span className="shrink-0 text-xs text-muted">
              {b.proposed_at} · {b.proc_result ?? "계류"}
            </span>
          </li>
        ))}
      </ul>
      {total > bills.length && (
        <p className="px-4 py-2 text-xs text-muted">
          최근 {bills.length}건만 표시 (전체 {total}건)
        </p>
      )}
    </>
  );
}

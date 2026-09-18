import Link from "next/link";
import { notFound } from "next/navigation";
import { db, lastPart, partyColor, pct, type Bill, type Member } from "@/lib/db";

export const revalidate = 3600;

type Row = { role: "rep" | "co"; bill: Bill | null };

export default async function MemberPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const [{ data: member }, { data: sponsored }, { data: votes }, { data: candidacies }, { data: pledges }] =
    await Promise.all([
      db.from("member").select("*").eq("code", code).maybeSingle(),
      db
        .from("bill_sponsor")
        .select("role, bill:bill(bill_id,bill_no,name,committee,proposed_at,proc_result,proposer,detail_link)")
        .eq("member_code", code),
      db.from("vote").select("result").eq("member_code", code),
      db.from("candidacy").select("*").eq("member_code", code).order("election_id", { ascending: false }),
      db
        .from("pledge")
        .select("id, title, body, category, election_id, pledge_status(status, decided_by)")
        .eq("member_code", code)
        .order("order_no"),
    ]);

  if (!member) notFound();
  const m = member as Member;

  const rows = ((sponsored ?? []) as unknown as Row[]).filter((r) => r.bill);
  const rep = rows.filter((r) => r.role === "rep").map((r) => r.bill!);
  const co = rows.filter((r) => r.role === "co").map((r) => r.bill!);
  const passed = rep.filter((b) => b.proc_result?.includes("가결")).length;
  const pending = rep.filter((b) => !b.proc_result).length;

  const tally = (votes ?? []).reduce<Record<string, number>>((acc, v) => {
    acc[v.result] = (acc[v.result] ?? 0) + 1;
    return acc;
  }, {});
  const voteTotal = (votes ?? []).length;
  const attended = voteTotal - (tally["불참"] ?? 0);

  const sortDesc = (a: Bill, b: Bill) => (b.proposed_at ?? "").localeCompare(a.proposed_at ?? "");

  return (
    <div className="space-y-6">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 의원
      </Link>

      <header className="flex gap-4 rounded-lg border border-line bg-card p-4">
        <span className="w-1.5 rounded-full" style={{ background: partyColor(m.party) }} />
        {m.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.photo_url} alt="" className="h-24 w-20 rounded object-cover" />
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{m.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {lastPart(m.party)} · {m.district} · {m.term_count} ({m.terms})
          </p>
          {m.committees && <p className="mt-1 text-xs text-muted">{m.committees}</p>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="대표발의" value={rep.length} unit="건" />
        <Stat label="공동발의" value={co.length} unit="건" />
        <Stat
          label="대표발의 가결률"
          value={pct(passed, rep.length)}
          unit="%"
          sub={`가결 ${passed} · 계류 ${pending}`}
        />
        <Stat
          label="본회의 표결 참여"
          value={pct(attended, voteTotal)}
          unit="%"
          sub={`${attended}/${voteTotal}회`}
        />
      </section>

      {voteTotal > 0 && (
        <section className="rounded-lg border border-line bg-card p-4">
          <h2 className="text-sm font-semibold">표결 성향</h2>
          <div className="mt-2 flex gap-4 text-sm text-muted">
            {["찬성", "반대", "기권", "불참"].map((k) => (
              <span key={k}>
                {k} <b className="text-foreground">{tally[k] ?? 0}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      <Section title="공약" count={pledges?.length ?? 0}>
        {pledges?.length ? (
          <ul className="divide-y divide-line">
            {pledges.map((p) => {
              const st = (p.pledge_status as unknown as { status: string; decided_by: string } | null);
              return (
                <li key={p.id} className="flex gap-3 px-4 py-3 text-sm">
                  <StatusBadge status={st?.status} auto={st?.decided_by !== "reviewer"} />
                  <div>
                    <p className="font-medium">{p.title}</p>
                    {p.body && <p className="mt-0.5 text-xs text-muted">{p.body}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">
            아직 공약 데이터가 없습니다. 선거공보 수집(Phase 3) 후 표시됩니다.
          </p>
        )}
      </Section>

      <Section title="출마 이력" count={candidacies?.length ?? 0}>
        {candidacies?.length ? (
          <ul className="divide-y divide-line">
            {candidacies.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 px-4 py-2 text-sm">
                <span>
                  {c.election_name} · {c.district} · {c.party}
                </span>
                <span className={c.elected ? "font-semibold" : "text-muted"}>
                  {c.vote_rate != null && `${c.vote_rate}% `}
                  {c.elected ? "당선" : "낙선"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">
            아직 출마 이력이 없습니다. 선관위 수집(Phase 2) 후 표시됩니다.
          </p>
        )}
      </Section>

      <Section title="대표발의 법안" count={rep.length}>
        <BillList bills={[...rep].sort(sortDesc)} />
      </Section>

      <Section title="공동발의 법안" count={co.length}>
        <BillList bills={[...co].sort(sortDesc)} />
      </Section>
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

const MAX = 50;

function BillList({ bills }: { bills: Bill[] }) {
  if (!bills.length) return <p className="px-4 py-3 text-sm text-muted">없습니다.</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {bills.slice(0, MAX).map((b) => (
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
      {bills.length > MAX && (
        <p className="px-4 py-2 text-xs text-muted">최근 {MAX}건만 표시 (전체 {bills.length}건)</p>
      )}
    </>
  );
}

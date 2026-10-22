import type { Metadata } from "next";
import Link from "@/lib/link";
import { notFound } from "next/navigation";
import { db, eok, electionYear, KIND_LABEL, noteText, STATUS_BG } from "@/lib/db";
import { pageOg, REPORT_URL } from "@/lib/site";
import { kstDate, REASON_LABEL, timeline, versionDiff, type Facts, type LogRow } from "@/lib/timeline";

export const revalidate = 86400;

/** 처음 열릴 때 그려 ISR 로 둔다(법안 페이지와 같은 이유). */
export async function generateStaticParams() {
  return [];
}

/** 공약 하나의 판정·근거 원문·판정 이력. 판정은 규칙표(judge.py decide)가 하고, 이 화면은
 *  그 판정이 언제 어떤 공개 기록 때문에 바뀌었는지를 보인다. 신뢰도(score)는 싣지 않는다 — 점수처럼 읽힌다.
 *
 *  판정 이력(pledge_status_log)·근거 버전(source_version)·원문 구절 칸은 운영 DB 에 나중에 들어온다.
 *  그 전에도 이 화면이 떠야 해서(인물 페이지가 여기로 잇는다) 새 것은 따로 읽고 실패하면 비운다. */

type Pledge = {
  id: number; title: string; body: string | null; category: string | null; kinds: string[] | null;
  election_id: string | null; source: string | null; doc_id: number | null; order_no: number | null;
  member: { code: string; name: string; office: string | null } | null;
  pledge_status: { status: string; decided_by: string; note: string | null; updated_at: string } | null;
  pledge_evidence: { id: number; kind: string; ref_id: string; summary: string | null }[];
};
type EvExtra = {
  id: number; quote: string | null; quote_ok: boolean | null;
  model: string | null; prompt: string | null; linked_at: string | null;
};
type Version = { kind: string; ref_id: string; seen_at: string; facts: Facts };

const KIND_NAME: Record<string, string> = { bill: "근거 법안", ordin: "근거 조례", bid: "발주 공고" };
const FACT_LABEL: Record<string, string> = {
  name: "이름", proc_result: "처리결과", proc_dt: "처리일", alt_id: "대안", alt_result: "대안 처리결과",
  last_id: "최신 조례", rr_kind: "제·개정", effective_at: "시행일", announced_at: "공포일",
  budget: "예산(원)", notice_at: "공고일",
};
const fact = (k: string, v: unknown) => `${FACT_LABEL[k] ?? k} ${v ?? "없음"}`;

const PLEDGE_COLS =
  "id, title, body, category, kinds, election_id, source, doc_id, order_no, member(code, name, office)," +
  " pledge_status(status, decided_by, note, updated_at), pledge_evidence(id, kind, ref_id, summary)";

const parseId = (id: string) => (/^\d{1,15}$/.test(id) ? Number(id) : null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const pid = parseId((await params).id);
  if (pid == null) return { title: "찾을 수 없는 공약" };
  const { data } = await db.from("pledge").select(PLEDGE_COLS).eq("id", pid).maybeSingle();
  if (!data) return { title: "찾을 수 없는 공약" };
  const p = data as unknown as Pledge;
  const st = p.pledge_status;
  // 설명에는 실제 값만 — 판정과 그 근거 문장.
  const description = [
    p.member && `${p.member.name}(${p.member.office ?? "국회의원"}) ${electionYear(p.election_id)}년 공약`,
    st ? `판정 ${st.status}${st.note ? ` — ${noteText(st.note)}` : ""}` : "아직 판정 전",
  ].filter(Boolean).join(" · ");
  return {
    title: p.title,
    description,
    alternates: { canonical: `/pledge/${pid}` },
    ...pageOg(p.title, description, `/pledge/${pid}`, { type: "article" }),
  };
}

export default async function PledgePage({ params }: { params: Promise<{ id: string }> }) {
  const pid = parseId((await params).id);
  if (pid == null) notFound();

  const [base, extra, logRes] = await Promise.all([
    db.from("pledge").select(PLEDGE_COLS).eq("id", pid).maybeSingle(),
    db.from("pledge_evidence").select("id, quote, quote_ok, model, prompt, linked_at").eq("pledge_id", pid),
    db.from("pledge_status_log").select("at, status, note, prev_status, prev_note, reason, rule").eq("pledge_id", pid).order("id"),
  ]);
  // DB 오류를 '없는 공약' 404 로 내지 않는다(법안 페이지와 같은 처리).
  if (base.error) throw base.error;
  if (!base.data) notFound();
  const p = base.data as unknown as Pledge;
  // 아래 둘은 새 칸·새 표라 아직 없을 수 있다. 없으면 비운다.
  const extraBy = new Map(((extra.error ? [] : extra.data ?? []) as EvExtra[]).map((e) => [e.id, e]));
  const log = (logRes.error ? [] : logRes.data ?? []) as (LogRow & { rule: string | null })[];

  const refs = (k: string) => p.pledge_evidence.filter((e) => e.kind === k).map((e) => e.ref_id);
  const none = Promise.resolve({ data: [] as never[], error: null });
  const [bills, alts, ordins, bids, versions, doc] = await Promise.all([
    refs("bill").length
      ? db.from("bill").select("bill_id, name, proposed_at, proc_dt, proc_result").in("bill_id", refs("bill"))
      : none,
    refs("bill").length
      ? db.from("bill_alt").select("bill_id, alt_id, alt_name, alt_result, alt_dt").in("bill_id", refs("bill"))
      : none,
    refs("ordin").length
      ? db.from("ordinance").select("id, name, rr_kind, announced_at, url").in("id", refs("ordin"))
      : none,
    refs("bid").length
      ? db.from("bid_notice").select("id, name, budget, notice_at, url").in("id", refs("bid"))
      : none,
    p.pledge_evidence.length
      ? db.from("source_version").select("kind, ref_id, seen_at, facts")
          .in("ref_id", p.pledge_evidence.map((e) => e.ref_id)).order("id")
      : none,
    p.doc_id ? db.from("pledge_doc_link").select("pdf_url").eq("id", p.doc_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  type BillRow = { bill_id: string; name: string; proposed_at: string | null; proc_dt: string | null; proc_result: string | null };
  type AltRow = { bill_id: string; alt_id: string; alt_name: string; alt_result: string | null; alt_dt: string | null };
  type OrdinRow = { id: string; name: string; rr_kind: string | null; announced_at: string | null; url: string | null };
  type BidRow = { id: string; name: string; budget: number | null; notice_at: string | null; url: string | null };
  const billBy = new Map(((bills.data ?? []) as BillRow[]).map((b) => [b.bill_id, b]));
  const altBy = new Map(((alts.error ? [] : alts.data ?? []) as AltRow[]).map((a) => [a.bill_id, a]));
  const ordinBy = new Map(((ordins.data ?? []) as OrdinRow[]).map((o) => [o.id, o]));
  const bidBy = new Map(((bids.data ?? []) as BidRow[]).map((b) => [b.id, b]));
  const vers = ((versions.error ? [] : versions.data ?? []) as Version[]).filter((v) =>
    p.pledge_evidence.some((e) => e.kind === v.kind && e.ref_id === v.ref_id));
  const pdf = (doc.data as { pdf_url: string } | null)?.pdf_url;

  const nameOf = (kind: string, ref: string) =>
    kind === "bill" ? billBy.get(ref)?.name : kind === "ordin" ? ordinBy.get(ref)?.name : bidBy.get(ref)?.name;
  const st = p.pledge_status;
  const lastLog = log.at(-1);
  const change = [...log].reverse().find((l) => l.prev_status != null);
  // 표시만 한다. 구절 확인은 판정(완료 등)의 조건이 아니다 — 원문 일치율을 몇 주 본 뒤 정한다(설계 열린 질문 1).
  const quoted = p.pledge_evidence.filter((e) => extraBy.get(e.id)?.quote_ok).length;

  const events = timeline({
    election: p.election_id
      ? { date: p.election_id, label: `공약 (${p.source === "공약서" ? "선거공약서" : p.source ?? "선거공보"})` }
      : null,
    records: [
      ...[...billBy.values()].flatMap((b) => [
        { date: b.proposed_at, text: `대표발의 · ${b.name}`, href: `/bill/${b.bill_id}` },
        { date: b.proc_dt, text: `처리: ${b.proc_result ?? ""} · ${b.name}`, href: `/bill/${b.bill_id}` },
      ]),
      ...[...altBy.values()].map((a) => ({ date: a.alt_dt, text: `대안 ${a.alt_result ?? "처리"} · ${a.alt_name}` })),
      ...[...ordinBy.values()].map((o) => ({ date: o.announced_at, text: `조례 ${o.rr_kind ?? ""} 공포 · ${o.name}`, href: o.url ?? undefined })),
      ...[...bidBy.values()].map((b) => ({
        date: b.notice_at,
        text: `공사 입찰 공고 · ${b.name}${b.budget ? ` ${eok(b.budget / 1000)}` : ""}`,
        href: b.url ?? undefined,
      })),
    ],
    log,
    versions: vers.map((v) => ({
      ref: `${v.kind}:${v.ref_id}`, label: nameOf(v.kind, v.ref_id) ?? v.ref_id, seen_at: v.seen_at, facts: v.facts,
    })),
    factLabel: fact,
  });

  return (
    <div className="space-y-5">
      {p.member && (
        <Link href={`/m/${p.member.code}`} className="text-xs text-muted hover:underline">
          ← {p.member.name} · {p.member.office ?? "국회의원"}
        </Link>
      )}

      <header className="rounded-lg border border-line bg-card p-4">
        <p className="text-xs text-muted">
          {[
            p.election_id && `${electionYear(p.election_id)}년 선거`,
            p.source === "공약서" ? `대표공약${p.order_no ? ` ${p.order_no}` : ""}` : p.source,
            p.category,
          ].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-1 text-lg font-bold">{p.title}</h1>
        {!!p.kinds?.length && (
          <p className="mt-1 text-xs text-muted">유형: {p.kinds.map((k) => KIND_LABEL[k] ?? k).join(", ")}</p>
        )}
        {p.body && <p className="mt-3 max-w-prose whitespace-pre-wrap text-sm text-muted">{p.body}</p>}
      </header>

      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="text-base font-semibold">지금 판정</h2>
        {st ? (
          <>
            <p className="mt-2 text-sm">
              <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${STATUS_BG[st.status] ?? STATUS_BG.판단불가}`}>
                {st.status}
              </span>{" "}
              <span className="text-xs text-muted">{st.decided_by === "reviewer" ? "사람 검수" : "자동 판정"}</span>{" "}
              {st.note && <span>{noteText(st.note)}</span>}
            </p>
            {quoted > 0 && (
              <p className="mt-1 text-xs text-muted">
                ✓ 원문 구절 확인됨 (법안 근거 {p.pledge_evidence.filter((e) => e.kind === "bill").length}건 중 {quoted}건) — 판정에는 쓰지 않는 표시입니다.
              </p>
            )}
            <p className="mt-1 text-xs text-muted">
              {kstDate(lastLog?.at ?? st.updated_at)} 판정
              {lastLog?.rule && lastLog.rule !== "manual" && (
                <>
                  {" · "}
                  <Link href="/rules#changes" className="underline underline-offset-2">규칙 판 {lastLog.rule}</Link>
                </>
              )}{" "}
              ·{" "}
              <Link href="/rules" className="underline underline-offset-2">판정 기준</Link>
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">아직 판정 전입니다(유형 분류 대기).</p>
        )}
        {change && change.prev_status !== change.status && (
          <p className="mt-3 border-t border-line pt-3 text-sm">
            <span className="text-muted">직전 판정과 다른 점 · </span>
            {change.prev_status}
            {change.prev_note ? `(${noteText(change.prev_note)})` : ""} → {change.status}
            {change.note ? `(${noteText(change.note)})` : ""}
            <span className="text-muted"> · 사유: {REASON_LABEL[change.reason] ?? change.reason}</span>
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold">근거</h2>
        {p.pledge_evidence.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">
            연결된 공개 기록이 없습니다.{st?.note ? ` ${noteText(st.note)}` : ""}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {p.pledge_evidence.map((e) => {
              const x = extraBy.get(e.id);
              const b = e.kind === "bill" ? billBy.get(e.ref_id) : undefined;
              const alt = e.kind === "bill" ? altBy.get(e.ref_id) : undefined;
              const o = e.kind === "ordin" ? ordinBy.get(e.ref_id) : undefined;
              const bd = e.kind === "bid" ? bidBy.get(e.ref_id) : undefined;
              const href = b ? `/bill/${e.ref_id}` : (o?.url ?? bd?.url ?? undefined);
              const mine = vers.filter((v) => v.kind === e.kind && v.ref_id === e.ref_id);
              const diff = mine.length > 1 ? versionDiff(mine.at(-2)!.facts, mine.at(-1)!.facts) : [];
              return (
                <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
                  <p>
                    <span className="text-muted">{KIND_NAME[e.kind] ?? e.kind} · </span>
                    {href ? (
                      <a href={href} className="underline underline-offset-2" {...(b ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                        {nameOf(e.kind, e.ref_id) ?? e.ref_id}
                      </a>
                    ) : (
                      nameOf(e.kind, e.ref_id) ?? e.ref_id
                    )}
                    {b && <span className="text-muted"> [{b.proc_result ?? "계류"}{alt ? ` → 대안 ${alt.alt_result ?? "처리"}` : ""}]</span>}
                    {o?.rr_kind && <span className="text-muted"> [{o.rr_kind}]</span>}
                    {bd?.budget ? <span className="text-muted"> {eok(bd.budget / 1000)}</span> : null}
                  </p>
                  {/* 원문 구절은 서버가 원문에서 다시 찾은 것만 싣는다(judge.py quote · locate). */}
                  {x?.quote_ok && x.quote ? (
                    <p className="text-xs">
                      <span className="text-muted">원문 구절 </span>&ldquo;{x.quote}&rdquo;
                      <span className="text-muted"> ✓ 원문 구절 확인됨</span>
                    </p>
                  ) : x?.quote_ok === false ? (
                    <p className="text-xs text-muted">
                      {x.quote ? "AI 가 고른 구절이 원문과 달라 싣지 않습니다." : "AI 가 원문에서 같은 일을 하는 부분을 찾지 못했습니다."}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted">
                    연결{" "}
                    {x?.model?.startsWith("reviewer")
                      ? "사람 검수"
                      : `AI${x?.model ? `(${x.model.replace(/^[a-z]+:/, "")}${x.prompt ? ` · ${x.prompt}` : ""})` : ""}`}
                    {x?.linked_at ? ` ${kstDate(x.linked_at)}` : ""}
                    {e.summary ? ` · 이유: ${e.summary}` : ""}
                  </p>
                  {diff.length > 0 && (
                    <p className="text-xs text-muted">
                      기록 변화 {diff.map(([k, a, c]) => `${fact(k, a)} → ${fact(k, c)}`).join(", ")} (
                      {kstDate(mine.at(-1)!.seen_at)} 확인)
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold">타임라인</h2>
        <p className="px-4 pt-3 text-xs text-muted">
          날짜는 일어난 날, ◇ 는 이 사이트가 확인한 날입니다. 판정은 주 1회라 확인한 날이 월요일에 몰립니다.
          {log[0]?.reason === "baseline" && " 첫 판정은 기록을 시작한 때의 판정이고, 그 전 이력은 없습니다."}
        </p>
        <ol className="space-y-1 px-4 py-3 text-sm">
          {events.map((ev, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-24 shrink-0 tabular-nums text-muted">
                {ev.kind === "seen" ? "◇" : ""}
                {ev.date}
              </span>
              {ev.href ? (
                <a href={ev.href} className="underline underline-offset-2">{ev.text}</a>
              ) : (
                <span>{ev.text}</span>
              )}
            </li>
          ))}
        </ol>
      </section>

      <p className="text-xs text-muted">
        {pdf && (
          <>
            <a href={pdf} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              선거공보 원문(PDF)
            </a>
            {" · "}
          </>
        )}
        <a href={REPORT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          원문과 다른 점 알려주기(GitHub)
        </a>
      </p>
    </div>
  );
}

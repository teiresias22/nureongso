import Link from "next/link";
import { notFound } from "next/navigation";
import { db, lastPart, partyColor, type Bill, type Member } from "@/lib/db";

export const revalidate = 3600;

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [{ data: bill }, { data: sponsors }, { data: plenary }] = await Promise.all([
    db.from("bill").select("*").eq("bill_id", id).maybeSingle(),
    db
      .from("bill_sponsor")
      .select("role, member:member(code,name,party,district)")
      .eq("bill_id", id),
    db.from("plenary_bill").select("*").eq("bill_id", id).maybeSingle(),
  ]);

  if (!bill) notFound();
  const b = bill as Bill;

  type S = { role: "rep" | "co"; member: Member | null };
  const list = ((sponsors ?? []) as unknown as S[]).filter((s) => s.member);
  const rep = list.filter((s) => s.role === "rep").map((s) => s.member!);
  const co = list.filter((s) => s.role === "co").map((s) => s.member!);

  return (
    <div className="space-y-5">
      <Link href="/" className="text-xs text-muted hover:underline">
        ← 전체 목록
      </Link>

      <header className="rounded-lg border border-line bg-card p-4">
        <h1 className="text-lg font-bold">{b.name}</h1>
        <p className="mt-1 text-sm text-muted">
          의안번호 {b.bill_no} · 제안 {b.proposed_at} · {b.committee ?? "위원회 미배정"}
        </p>
        <p className="mt-2 text-sm">
          <span className="rounded bg-foreground px-2 py-0.5 text-xs text-background">
            {b.proc_result ?? "계류 중"}
          </span>
        </p>
        {b.detail_link && (
          <a
            href={b.detail_link}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-xs text-muted underline"
          >
            의안정보시스템 원문 보기
          </a>
        )}
      </header>

      {plenary && (
        <section className="rounded-lg border border-line bg-card p-4 text-sm">
          <h2 className="font-semibold">본회의 표결 결과</h2>
          <p className="mt-2 text-muted">
            재석 {plenary.vote_cnt} · 찬성 <b className="text-foreground">{plenary.yes_cnt}</b> · 반대{" "}
            <b className="text-foreground">{plenary.no_cnt}</b> · 기권{" "}
            <b className="text-foreground">{plenary.blank_cnt}</b>
          </p>
        </section>
      )}

      <Group title="대표발의" members={rep} />
      <Group title="공동발의" members={co} />
    </div>
  );
}

function Group({ title, members }: { title: string; members: Member[] }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-card">
      <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted">{members.length}</span>
      </h2>
      {members.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted">없습니다.</p>
      ) : (
        <ul className="flex flex-wrap gap-2 p-4">
          {members.map((m) => (
            <li key={m.code}>
              <Link
                href={`/m/${m.code}`}
                className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-sm hover:border-muted"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: partyColor(m.party) }}
                />
                {m.name}
                <span className="text-xs text-muted">{lastPart(m.party)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

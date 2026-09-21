import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db, lastPart, partyColor, type Bill } from "@/lib/db";
import { SITE } from "@/lib/site";

export const revalidate = 3600;

/** 발의자 조인 뷰. bill_sponsor.member_code 에는 외래키가 없어 PostgREST 가
 *  member 를 임베드하지 못한다. member_bill 과 같은 방식으로 뷰를 쓴다. */
type Sponsor = {
  role: "rep" | "co";
  code: string;
  name: string;
  party: string | null;
};

type SP = { from?: string };

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const { data } = await db
    .from("bill")
    .select("name, bill_no, proc_result, summary")
    .eq("bill_id", id)
    .maybeSingle();
  if (!data) return { title: "찾을 수 없는 법안" };

  const b = data as Pick<Bill, "name" | "bill_no" | "proc_result"> & { summary: string | null };
  // 국회가 준 제안이유 원문을 그대로 줄인다. 새로 요약하지 않는다.
  const description = b.summary
    ? b.summary.replace(/\s+/g, " ").slice(0, 160)
    : `의안번호 ${b.bill_no} · ${b.proc_result ?? "계류 중"}. 발의자와 처리 결과를 봅니다.`;
  return {
    title: b.name,
    description,
    // 어디서 왔는지 표시하는 ?from= 이 붙는다. 같은 법안이 의원 수만큼 색인될 수 있다.
    alternates: { canonical: `/bill/${id}` },
    openGraph: { title: b.name, description, type: "article", url: `/bill/${id}` },
    twitter: { card: "summary_large_image", title: b.name, description },
  };
}

export default async function BillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  const { id } = await params;
  const { from } = await searchParams;

  const [{ data: bill }, { data: sponsors }, { data: plenary }, { data: backTo }] =
    await Promise.all([
      db.from("bill").select("*").eq("bill_id", id).maybeSingle(),
      db
        .from("bill_sponsor_member")
        .select("role, code, name, party")
        .eq("bill_id", id)
        .order("role")
        .order("name"),
      db.from("plenary_bill").select("*").eq("bill_id", id).maybeSingle(),
      // 어느 의원 페이지에서 왔는지 알면 그리로 돌아간다
      from
        ? db.from("member").select("code, name").eq("code", from).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (!bill) notFound();
  const b = bill as Bill & { summary: string | null };

  const list = (sponsors ?? []) as Sponsor[];
  const rep = list.filter((s) => s.role === "rep");
  const co = list.filter((s) => s.role === "co");
  const back = backTo as { code: string; name: string } | null;

  return (
    <div className="space-y-5">
      {/* 법안은 Legislation 으로 알린다. 요약은 국회 원문이라 그대로 넘긴다. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Legislation",
            name: b.name,
            legislationIdentifier: b.bill_no || undefined,
            legislationDate: b.proposed_at || undefined,
            legislationType: "법률안",
            legislationJurisdiction: "대한민국",
            inLanguage: "ko",
            abstract: b.summary ? b.summary.replace(/\s+/g, " ").slice(0, 400) : undefined,
            author: rep.map((r) => ({ "@type": "Person", name: r.name })),
            url: `${SITE}/bill/${id}`,
          }),
        }}
      />
      <Link
        href={back ? `/m/${back.code}` : "/"}
        className="text-xs text-muted hover:underline"
      >
        ← {back ? `${back.name} 의원` : "전체 목록"}
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

      {b.summary && (
        <section className="rounded-lg border border-line bg-card">
          <h2 className="border-b border-line px-4 py-2 text-sm font-semibold">
            제안이유 및 주요내용
          </h2>
          {/* 국회가 제공하는 원문 그대로다. 요약하거나 고쳐 쓰지 않는다. */}
          <p className="whitespace-pre-wrap px-4 py-3 text-sm leading-relaxed">
            {b.summary}
          </p>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            출처: 열린국회정보 「법률안 제안이유 및 주요내용」 원문
          </p>
        </section>
      )}

      {plenary && (
        <section className="rounded-lg border border-line bg-card p-4 text-sm">
          <h2 className="font-semibold">본회의 표결 결과</h2>
          <p className="mt-2 text-muted">
            재석 {plenary.vote_cnt} · 찬성 <b className="text-foreground">{plenary.yes_cnt}</b> ·
            반대 <b className="text-foreground">{plenary.no_cnt}</b> · 기권{" "}
            <b className="text-foreground">{plenary.blank_cnt}</b>
          </p>
        </section>
      )}

      <Group title="대표발의" members={rep} />
      <Group title="공동발의" members={co} />
    </div>
  );
}

function Group({ title, members }: { title: string; members: Sponsor[] }) {
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

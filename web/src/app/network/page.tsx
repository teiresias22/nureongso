import Link from "next/link";
import { db, partyColor, partyLine, pct, shortDistrict, type Cosponsor } from "@/lib/db";
import { forceLayout, labelBox, separate } from "@/lib/force";
import { pageOg } from "@/lib/site";
import { Graph, type GraphEdge, type GraphNode } from "./graph";

export const revalidate = 3600;

const TITLE = "공동발의 관계도";
const DESC =
  "국회의원이 대표발의한 법안에 누가 공동발의자로 자주 이름을 올렸는지 22대 현직 의원 전체를 한 장에 그렸습니다.";

export const metadata = {
  title: TITLE,
  alternates: { canonical: "/network" },
  description: DESC,
  ...pageOg(`누렁소검은소 — ${TITLE}`, DESC, "/network"),
};

/** 이보다 의석이 적은 정당은 속 빈 점(이름표)으로 그린다. 국민의힘·진보당(빨강), 개혁신당·사회민주당
 *  (주황)은 공식 색이 서로 거의 같아 색만으로는 못 가른다. 큰 당은 색, 작은 당은 모양까지. */
const SMALL_PARTY = 10;
/** 함께 이름을 올린 법안이 이보다 적으면 선을 긋지 않는다. 의원 페이지 목록도 같은 기준. */
const MIN_N = 3;

export default async function NetworkPage() {
  const [{ data: mps, error }, ...tops] = await Promise.all([
    db.from("member").select("code, name, party, district").eq("is_incumbent", true).eq("office", "국회의원"),
    // 의원당 많아야 5줄, 현직 300명이면 1,500행 남짓. PostgREST 는 1000행에서 조용히 자르므로
    // 기본키 순으로 둘로 나눠 읽는다(300×5 < 2000). 1,500행짜리 작은 표라 OFFSET 이어도 된다 —
    // 큰 표는 keyset 으로(ops.md, sitemap.ts).
    // 3건 미만은 잇지 않는다. 대표발의가 1~2건이면 공동발의자 10여 명이 모두 동률이라 상위가
    // 의원 코드 순으로 정해졌다(김남국 1건). 그런 선은 관계가 아니라 정렬 순서다.
    ...[0, 1000].map((from) =>
      db.from("cosponsor_top").select("a, b, n, nrep").gte("n", MIN_N)
        .order("a").order("b").range(from, from + 999)),
  ]);
  const topError = tops.find((t) => t.error)?.error;
  if (error || topError) throw error ?? topError;
  const top = tops.flatMap((t) => t.data ?? []);

  const seats = new Map<string, number>();
  for (const m of mps ?? []) seats.set(partyLine(m.party), (seats.get(partyLine(m.party)) ?? 0) + 1);
  // 큰 당부터, 당 안에서는 이름순. 이 순서대로 원 위에서 출발한다(force.ts).
  const people = [...(mps ?? [])].sort(
    (x, y) =>
      (seats.get(partyLine(y.party)) ?? 0) - (seats.get(partyLine(x.party)) ?? 0) ||
      partyLine(x.party).localeCompare(partyLine(y.party)) ||
      x.name.localeCompare(y.name),
  );
  const idx = new Map(people.map((m, i) => [m.code, i]));
  const edges = (top as Pick<Cosponsor, "a" | "b" | "n" | "nrep">[])
    .filter((e) => idx.has(e.a) && idx.has(e.b))
    .map((e): GraphEdge => ({ a: idx.get(e.a)!, b: idx.get(e.b)!, n: e.n, nrep: e.nrep, share: pct(e.n, e.nrep) }));
  // 그림의 선은 방향 없이 한 줄. 둘이 서로를 상위에 두면 한 번만 긋는다.
  const pairs = new Map<string, [number, number]>();
  for (const e of edges) pairs.set(e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`, [e.a, e.b]);
  // 850 폭으로 잡으면 이름표를 떼어 놓은 뒤 약 965 가 된다(separate).
  const { pos } = forceLayout(people.length, [...pairs.values()], 850);
  // 선이 하나도 없는 의원(국회의장 우원식, 대표발의 1~2건인 김남국 등)은 힘 배치에서 무리 밖
  // 먼 곳에 떠서 그림 상자를 늘렸다 — 휴대폰 첫 화면이 텅 비었다. 그림 아래 한 줄로 모은다.
  const linked = new Set([...pairs.values()].flat());
  const lone = people.flatMap((_, i) => (linked.has(i) ? [] : [i]));
  if (lone.length) {
    const on = pos.filter((_, i) => linked.has(i));
    const xs = on.map((p) => p[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, bottom = Math.max(...on.map((p) => p[1]));
    lone.forEach((i, k) => { pos[i] = [cx + (k - (lone.length - 1) / 2) * 70, bottom + 50]; });
  }
  const box = separate(pos, people.map((m) => labelBox(m.name)));
  // 검색 목록의 항목. 동명이인(박지원 둘, 둘 다 민주당)은 지역구까지 붙여야 갈린다.
  const dup = new Set(people.map((m) => m.name).filter((n, i, a) => a.indexOf(n) !== i));

  const nodes: GraphNode[] = people.map((m, i) => {
    const party = partyLine(m.party) || "무소속";
    return {
      code: m.code, name: m.name, party, x: pos[i][0], y: pos[i][1], w: labelBox(m.name)[0], color: partyColor(party),
      tag: [m.name, party, dup.has(m.name) && (shortDistrict(m.district) || "비례대표")].filter(Boolean).join(" · "),
      ring: party !== "무소속" && (seats.get(partyLine(m.party)) ?? 0) < SMALL_PARTY,
    };
  });
  const legend = [...new Set(nodes.map((n) => n.party))].map((p) => ({
    party: p,
    count: nodes.filter((n) => n.party === p).length,
    color: partyColor(p),
    ring: nodes.find((n) => n.party === p)!.ring,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{TITLE}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          점 하나가 22대 현직 국회의원 한 명입니다. 의원마다 <b className="text-foreground">자기가 대표발의한
          법안에 공동발의자로 가장 자주 이름을 올린 5명</b>과 선으로 잇습니다(3건 이상). 선이 굵을수록 함께 이름을 올린
          법안이 많습니다. 자주 함께 이름을 올린 사람끼리 가까이 모입니다.
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">
          법안은 의원 10명 이상이 함께해야 낼 수 있어 서명을 주고받는 일이 흔합니다. 선은 함께 서명한
          기록이지 친분이나 계파를 뜻하지 않습니다. 정당은 지금 소속 기준입니다.{" "}
          <Link href="/rules#cosponsor" className="underline underline-offset-2 hover:text-foreground">
            세는 방법
          </Link>
        </p>
      </div>
      <Graph nodes={nodes} edges={edges} legend={legend} box={box} lone={lone.map((i) => people[i].name)} />
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

export type GraphNode = {
  code: string; name: string; party: string; x: number; y: number; color: string; ring: boolean;
};
/** a 가 대표발의한 법안 nrep 건 중 b 가 n 건(share %)에 이름을 올렸다. a·b 는 nodes 의 번호. */
export type GraphEdge = { a: number; b: number; n: number; nrep: number; share: number };
type Legend = { party: string; count: number; color: string; ring: boolean };

/** 고른 의원은 주소의 #코드 에 둔다. 의원 페이지의 '관계도에서 보기' 가 그 사람을 고른 채로
 *  열리고, 주소를 남에게 보내도 같은 화면이 뜬다. 서버가 searchParams 를 읽으면 요청마다
 *  배치를 다시 계산하므로 페이지는 정적으로 두고 여기서 읽는다. */
const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
const hash = () => decodeURIComponent(window.location.hash.slice(1));
// location.hash 에 빈 값을 넣으면 맨 위로 튄다. 주소만 바꾸고 알림은 직접 보낸다.
const pick = (code: string) => {
  history.replaceState(null, "", code ? `#${code}` : window.location.pathname);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
};

const SIZE = 1000;
const width = (e: GraphEdge) => 0.8 + e.share * 0.035;

export function Graph({ nodes, edges, legend, height }: {
  nodes: GraphNode[]; edges: GraphEdge[]; legend: Legend[]; height: number;
}) {
  const sel = useSyncExternalStore(subscribe, hash, () => "");
  const si = nodes.findIndex((n) => n.code === sel);
  const out = edges.filter((e) => e.a === si).sort((x, y) => y.n - x.n);
  const inc = edges.filter((e) => e.b === si).sort((x, y) => y.share - x.share);
  const near = new Set([si, ...out.map((e) => e.b), ...inc.map((e) => e.a)]);
  const dim = si >= 0;

  // 둘이 서로를 상위에 두면 선이 두 번 겹친다. 굵은 쪽 하나만.
  const lines = new Map<string, GraphEdge>();
  for (const e of edges) {
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    const had = lines.get(key);
    if (!had || width(e) > width(had)) lines.set(key, e);
  }
  const line = (e: GraphEdge, className: string, key: string) => (
    <line key={key} x1={nodes[e.a].x} y1={nodes[e.a].y} x2={nodes[e.b].x} y2={nodes[e.b].y}
          strokeWidth={width(e)} className={className} />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-b border-line px-3 py-2 text-xs text-muted">
          {legend.map((l) => (
            <li key={l.party} className="flex items-center gap-1">
              <svg width="12" height="12" aria-hidden>
                <circle cx="6" cy="6" r={l.ring ? 4 : 5} fill={l.ring ? "var(--card)" : l.color}
                        stroke={l.ring ? l.color : undefined} strokeWidth={l.ring ? 2 : 0} />
              </svg>
              {l.party} {l.count}
            </li>
          ))}
        </ul>
        <svg viewBox={`0 0 ${SIZE} ${height}`} className="block h-auto w-full" role="img"
             aria-label={`22대 국회의원 ${nodes.length}명의 공동발의 관계도. 옆의 '의원 고르기' 에서 한 명씩 볼 수 있습니다.`}>
          <g>
            {[...lines].map(([k, e]) =>
              line(e, dim ? "stroke-muted/10" : "stroke-muted/35", k))}
          </g>
          {dim && <g>{[...out, ...inc].map((e, i) => line(e, "stroke-foreground/70", `s${i}`))}</g>}
          <g>
            {nodes.map((n, i) => (
              <g key={n.code} onClick={() => pick(i === si ? "" : n.code)} className="cursor-pointer"
                 opacity={dim && !near.has(i) ? 0.25 : 1}>
                {/* 점이 작아 손가락으로 맞히기 어렵다. 보이지 않는 큰 원이 누르는 자리다. */}
                <circle cx={n.x} cy={n.y} r={12} fill="transparent" />
                <circle cx={n.x} cy={n.y} r={i === si ? 10 : 6.5}
                        fill={n.ring ? "var(--card)" : n.color}
                        stroke={n.ring ? n.color : undefined} strokeWidth={n.ring ? 3 : 1}
                        className={n.ring ? undefined : "stroke-foreground/30"} />
                <title>{`${n.name} · ${n.party}`}</title>
              </g>
            ))}
          </g>
          {dim && (
            <g className="pointer-events-none">
              {[...near].map((i) => (
                // 고른 사람은 점 위, 이어진 사람은 점 아래. 작은 당끼리 붙어 있으면 이름이 겹쳤다.
                <text key={i} x={nodes[i].x} y={i === si ? nodes[i].y - 16 : nodes[i].y + 24} textAnchor="middle"
                      fontSize={i === si ? 24 : 18} fontWeight={i === si ? 700 : 400}
                      className="fill-foreground" stroke="var(--card)" strokeWidth={5} paintOrder="stroke">
                  {nodes[i].name}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>

      <aside className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs text-muted">의원 고르기</span>
          <select value={si >= 0 ? sel : ""} onChange={(e) => pick(e.target.value)}
                  className="mt-1 block min-h-11 w-full rounded-md border border-line bg-card px-2">
            <option value="">— 전체 보기 —</option>
            {legend.map((l) => (
              <optgroup key={l.party} label={`${l.party} ${l.count}명`}>
                {nodes.filter((n) => n.party === l.party)
                  .sort((x, y) => x.name.localeCompare(y.name))
                  .map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        {si < 0 ? (
          <p className="text-xs leading-5 text-muted">
            점을 누르거나 위에서 고르면 그 의원과 이어진 선만 남습니다. 점에 마우스를 올리면 이름이 보입니다.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-card">
            <div className="border-b border-line px-3 py-2">
              <Link href={`/m/${sel}`} className="font-semibold hover:underline">{nodes[si].name}</Link>{" "}
              <span className="text-xs text-muted">{nodes[si].party}</span>
            </div>
            <Rel title={`${nodes[si].name} 의원이 대표발의한 법안에 자주 이름을 올린 의원`}
                 rows={out.map((e) => ({ i: e.b, text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
            <Rel title={`${nodes[si].name} 의원이 자주 이름을 올린 법안의 대표발의자`}
                 hint="그 의원의 상위 3명 안에 든 경우만"
                 rows={inc.map((e) => ({ i: e.a, text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Rel({ title, hint, rows, nodes }: {
  title: string; hint?: string; rows: { i: number; text: string }[]; nodes: GraphNode[];
}) {
  return (
    <div className="border-b border-line px-3 py-2 last:border-b-0">
      <h2 className="text-xs font-semibold">{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted">없습니다</p>
      ) : (
        <ul className="mt-1">
          {rows.map(({ i, text }) => (
            <li key={i} className="flex items-baseline gap-2">
              <button type="button" onClick={() => pick(nodes[i].code)}
                      className="min-h-9 text-left underline-offset-2 hover:underline">
                {nodes[i].name}
              </button>
              <span className="text-xs text-muted">{nodes[i].party}</span>
              <span className="ml-auto text-xs tabular-nums">{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

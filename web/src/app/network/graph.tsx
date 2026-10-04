"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LABEL_FONT, labelBox } from "@/lib/force";

export type GraphNode = {
  code: string; name: string; party: string; x: number; y: number; w: number; color: string; ring: boolean;
  /** 검색 목록에 뜨는 글. '이름 · 정당', 동명이인은 지역구까지. */
  tag: string;
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

const H = labelBox("")[1];
const width = (e: GraphEdge) => 0.8 + e.share * 0.035;

export function Graph({ nodes, edges, legend, box }: {
  nodes: GraphNode[]; edges: GraphEdge[]; legend: Legend[]; box: readonly [number, number, number, number];
}) {
  const sel = useSyncExternalStore(subscribe, hash, () => "");
  const si = nodes.findIndex((n) => n.code === sel);
  const out = edges.filter((e) => e.a === si).sort((x, y) => y.n - x.n);
  const inc = edges.filter((e) => e.b === si).sort((x, y) => y.share - x.share);
  const near = new Set([si, ...out.map((e) => e.b), ...inc.map((e) => e.a)]);
  const dim = si >= 0;
  // 이름표는 켜야 보인다. 299개가 한꺼번에 뜨면 무리가 어떻게 갈리는지보다 글자가 먼저 읽힌다.
  // 점과 이름표는 같은 자리에 놓여(separate 가 이름표 기준으로 떼어 둔 자리) 켜고 꺼도 그림이 움직이지 않는다.
  const [names, setNames] = useState(false);

  // 검색으로 고른 사람이 화면 밖이면 데려온다. 휴대폰에서는 그림이 화면보다 넓어 옆으로도.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el || si < 0) return;
    if (el.scrollWidth > el.clientWidth) {
      const x = ((nodes[si].x - box[0]) / box[2]) * el.scrollWidth;
      el.scrollTo({ left: x - el.clientWidth / 2, behavior: "smooth" });
    }
    const r = el.getBoundingClientRect();
    const y = r.top + ((nodes[si].y - box[1]) / box[3]) * r.height;
    if (y < 80 || y > window.innerHeight - 40) window.scrollBy({ top: y - window.innerHeight / 2, behavior: "smooth" });
  }, [si, nodes, box]);

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

  const dot = (i: number) => {
    const n = nodes[i];
    return (
      <circle key={`d${i}`} cx={n.x} cy={n.y} r={i === si ? 10 : 6.5}
              fill={n.ring ? "var(--card)" : n.color}
              stroke={n.ring ? n.color : undefined} strokeWidth={n.ring ? 3 : 1}
              className={n.ring ? undefined : "stroke-foreground/30"} />
    );
  };
  const label = (i: number) => {
    const n = nodes[i], fs = i === si ? 24 : 18;
    // 고른 사람은 점 위, 이어진 사람은 점 아래. 그림 가장자리에서 잘리면 반대쪽으로 —
    // 맨 위에 있는 한창민의 이름이 그림 테두리에 반쯤 잘렸다.
    let up = i === si;
    if (up && n.y - 16 - fs < box[1]) up = false;
    if (!up && n.y + fs + 8 > box[1] + box[3]) up = true;
    const half = (n.name.length * fs) / 2; // 한글 한 글자 폭 ≈ 글자 크기
    const anchor = n.x - half < box[0] ? "start" : n.x + half > box[0] + box[2] ? "end" : "middle";
    return (
      <text key={`t${i}`} x={n.x} y={up ? n.y - 16 : n.y + fs + 8} textAnchor={anchor}
            fontSize={fs} fontWeight={i === si ? 700 : 400}
            className="fill-foreground" stroke="var(--card)" strokeWidth={5} paintOrder="stroke">
        {n.name}
      </text>
    );
  };

  /** 목록에서 고른 글('이름 · 정당')이나, 동명이인이 없는 이름 그대로. 못 찾으면 undefined. */
  const find = (v: string) => {
    const q = v.trim();
    if (!q) return "";
    const exact = nodes.find((n) => n.tag === q);
    if (exact) return exact.code;
    const byName = nodes.filter((n) => n.name === q);
    return byName.length === 1 ? byName[0].code : undefined;
  };

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-x-4 gap-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const code = find(String(new FormData(e.currentTarget).get("q") ?? ""));
          if (code !== undefined) pick(code);
        }}
      >
        <label className="block w-full sm:w-72">
          <span className="text-xs text-muted">의원 이름 검색</span>
          {/* 고른 사람이 바뀌면(이름표를 눌러도) 새로 그려 그 이름을 보인다. */}
          <input
            key={sel} name="q" type="search" list="mp-tags" autoComplete="off"
            defaultValue={si >= 0 ? nodes[si].tag : ""} placeholder="이름을 입력하고 Enter"
            // 목록에서 고르면 바로, 이름만 쳤으면 Enter 로. 치는 도중에 고르면 '김현정' 을
            // 치다가 '김현' 에서 먼저 골라진다.
            onChange={(e) => {
              const v = e.target.value;
              if (!v) pick("");
              else if (nodes.some((n) => n.tag === v)) pick(find(v)!);
            }}
            className="mt-1 block min-h-11 w-full rounded-md border border-line bg-card px-3"
          />
          <datalist id="mp-tags">
            {nodes.map((n) => <option key={n.code} value={n.tag} />)}
          </datalist>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" role="switch" checked={names} onChange={(e) => setNames(e.target.checked)}
                 className="peer sr-only" />
          <span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-line transition peer-checked:bg-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-card after:shadow after:transition peer-checked:after:translate-x-4" />
          이름 표시
        </label>
        <p className="pb-3 text-xs text-muted">
          {dim
            ? "빈 곳을 누르면 전체 보기로 돌아갑니다."
            : "점을 누르거나 검색하면 그 의원과 이어진 선만 남습니다."}
        </p>
      </form>

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
        <div ref={wrap} className="overflow-x-auto">
          {/* 이름표를 켜면 글자가 11px 아래로 작아지지 않게 최소 폭을 둔다(휴대폰은 옆으로 넘겨 본다). */}
          <svg viewBox={box.join(" ")} className="block h-auto w-full"
               style={names ? { minWidth: Math.round(box[2] * 0.85) } : undefined}
               role="img" onClick={() => pick("")}
               aria-label={`22대 국회의원 ${nodes.length}명의 공동발의 관계도. 위의 검색으로 한 명씩 볼 수 있습니다.`}>
            <g>{[...lines].map(([k, e]) => line(e, dim ? "stroke-muted/10" : "stroke-muted/35", k))}</g>
            {dim && <g>{[...out, ...inc].map((e, i) => line(e, "stroke-foreground/70", `s${i}`))}</g>}
            {nodes.map((n, i) => (
              <g key={n.code} className="cursor-pointer" opacity={dim && !near.has(i) ? 0.2 : 1}
                 onClick={(e) => { e.stopPropagation(); pick(i === si ? "" : n.code); }}>
                {names ? (
                  <>
                    <rect x={n.x - n.w / 2 + 1} y={n.y - H / 2 + 1} width={n.w - 2} height={H - 2} rx={(H - 2) / 2}
                          fill={n.ring ? "var(--card)" : n.color}
                          stroke={i === si ? "var(--foreground)" : n.color} strokeWidth={i === si ? 3 : 1.5} />
                    {/* 당 색 바탕에 흰 글자. 글자를 당 색으로 칠하면 주황·청록·남색이 바탕과 대비가 모자랐다. */}
                    <text x={n.x} y={n.y} textAnchor="middle" dominantBaseline="central" fontSize={LABEL_FONT}
                          fontWeight={i === si ? 700 : 400} fill={n.ring ? "var(--foreground)" : "#fff"}>
                      {n.name}
                    </text>
                  </>
                ) : (
                  <>
                    {/* 점이 작아 손가락으로 맞히기 어렵다. 보이지 않는 큰 원이 누르는 자리다. */}
                    <circle cx={n.x} cy={n.y} r={12} fill="transparent" />
                    {dot(i)}
                  </>
                )}
                <title>{n.tag}</title>
              </g>
            ))}
            {/* 점일 때는 고른 사람과 이어진 사람만 이름을 단다. 고른 사람은 점 위, 이어진 사람은
                점 아래 — 작은 당끼리 붙어 있으면 이름이 겹쳤다. */}
            {!names && dim && (
              <g className="pointer-events-none">
                {[...near].filter((i) => i !== si).map(label)}
                {/* 고른 사람은 점과 이름 모두 맨 위에 다시 그린다. 먼저 그리면 이어진 사람의 이름과
                    그 흰 테두리가 덮었다. */}
                {dot(si)}
                {label(si)}
              </g>
            )}
          </svg>
        </div>
      </div>

      {si >= 0 && (
        <div className="overflow-hidden rounded-lg border border-line bg-card text-sm">
          <div className="border-b border-line px-4 py-2.5">
            <b>{nodes[si].name}</b> <span className="text-xs text-muted">{nodes[si].party}</span>
            <Link href={`/m/${sel}`} className="ml-2 text-xs text-muted underline underline-offset-2 hover:text-foreground">
              의원 페이지
            </Link>
          </div>
          <div className="grid sm:grid-cols-2">
            <Rel title={`${nodes[si].name} 의원이 대표발의한 법안에 자주 이름을 올린 의원`}
                 rows={out.map((e) => ({ i: e.b, text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
            <Rel title={`${nodes[si].name} 의원이 자주 이름을 올린 법안의 대표발의자`}
                 hint="그 의원의 상위 3명 안에 든 경우만"
                 rows={inc.map((e) => ({ i: e.a, text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
          </div>
        </div>
      )}
    </div>
  );
}

function Rel({ title, hint, rows, nodes }: {
  title: string; hint?: string; rows: { i: number; text: string }[]; nodes: GraphNode[];
}) {
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0 sm:border-b-0 sm:odd:border-r">
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

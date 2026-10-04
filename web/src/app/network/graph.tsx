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
/** 고른 사람의 선. 남이 내 법안에 이름을 올린 것(보라 점선), 내가 남의 법안에 올린 것
 *  (초록 점선), 둘 다인 것(황토 실선). 셋 다 밝은·어두운 바탕 색 검사를 통과했다.
 *  정당 색(남색·빨강·파랑·주황·청록·회색)이 색 공간을 많이 차지해 고를 자리가 좁았다 — 보라와
 *  초록을 섞은 파랑(#367fc5)은 조국혁신당 색과 거의 같았고(ΔE 4.8), 분홍은 진보당·국민의힘
 *  빨강에 가까웠다. 황토는 가장 가까운 정당 색(무소속 회색)과도 ΔE 14 떨어져 있다.
 *  초록과는 적록색약에서 가깝게 보여(ΔE 7.5) 실선·점선 모양으로도 가른다. */
type Kind = { color: string; dash?: string };
const OUT: Kind = { color: "#7c3aed", dash: "6 4" };
const IN: Kind = { color: "#16a34a", dash: "6 4" };
const BOTH: Kind = { color: "#a16207" };

export function Graph({ nodes, edges, legend, box }: {
  nodes: GraphNode[]; edges: GraphEdge[]; legend: Legend[]; box: readonly [number, number, number, number];
}) {
  const sel = useSyncExternalStore(subscribe, hash, () => "");
  const si = nodes.findIndex((n) => n.code === sel);
  const out = edges.filter((e) => e.a === si).sort((x, y) => y.n - x.n);
  const inc = edges.filter((e) => e.b === si).sort((x, y) => y.share - x.share);
  const near = new Set([si, ...out.map((e) => e.b), ...inc.map((e) => e.a)]);
  const dim = si >= 0;
  // 선 굵기는 비율이 아니라 건수. 비율로 하면 대표발의가 1건뿐인 의원(김남국·이소희)의 선이
  // '1건 중 1건, 100%' 로 가장 굵게 그려졌다. 비율은 아래 목록에 분모와 함께 적는다.
  const maxN = Math.max(1, ...edges.map((e) => e.n));
  const width = (e: GraphEdge) => 0.8 + Math.sqrt(e.n / maxN) * 4;
  // 서로를 상위 5명에 둔 사이는 한 줄로, 따로 정한 모양으로 긋는다. 보라·초록을 나란히
  // 비켜 그었더니 두 줄이 붙어 무엇인지 읽기 어려웠다. 굵기는 둘 중 많은 쪽.
  const mutual = new Set(out.map((e) => e.b).filter((b) => inc.some((e) => e.a === b)));
  const hl = (e: GraphEdge, kind: Kind) => {
    const other = e.a === si ? e.b : e.a;
    const back = kind === BOTH ? inc.find((x) => x.a === other) : undefined;
    const p = nodes[si], q = nodes[other];
    return <KindLine key={other} kind={kind} x1={p.x} y1={p.y} x2={q.x} y2={q.y}
                     w={Math.max(width(e), back ? width(back) : 0) + 0.5} />;
  };
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
    // 이름표를 켜면 그림이 넓어져 옆으로 넘기게 되므로 그때도 다시 데려온다. 빠뜨리면 휴대폰에서
    // 고른 사람이 화면 오른쪽 밖에 남았다.
  }, [si, nodes, box, names]);

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
        <div className="space-y-1 border-b border-line px-3 py-2 text-xs text-muted">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
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
        {/* 정당 줄과 선 줄을 나눈다. 한 줄에 이어 붙이면 어디까지가 점이고 어디부터가 선인지 흐렸다. */}
        {dim && (
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            <li className="flex items-center gap-1"><Swatch kind={OUT} />{nodes[si].name} 법안에 이름 올린 의원</li>
            <li className="flex items-center gap-1"><Swatch kind={IN} />{nodes[si].name} 의원이 이름 올린 법안</li>
            {mutual.size > 0 && <li className="flex items-center gap-1"><Swatch kind={BOTH} />서로 이름 올린 사이</li>}
          </ul>
        )}
        </div>
        <div ref={wrap} className="overflow-x-auto">
          {/* 이름표를 켜면 글자가 11px 아래로 작아지지 않게 최소 폭을 둔다(휴대폰은 옆으로 넘겨 본다). */}
          <svg viewBox={box.join(" ")} className="block h-auto w-full"
               style={names ? { minWidth: Math.round(box[2] * 0.85) } : undefined}
               role="img" onClick={() => pick("")}
               aria-label={`22대 국회의원 ${nodes.length}명의 공동발의 관계도. 위의 검색으로 한 명씩 볼 수 있습니다.`}>
            <g>{[...lines].map(([k, e]) => line(e, dim ? "stroke-muted/10" : "stroke-muted/35", k))}</g>
            {dim && (
              <g>
                {out.map((e) => hl(e, mutual.has(e.b) ? BOTH : OUT))}
                {inc.filter((e) => !mutual.has(e.a)).map((e) => hl(e, IN))}
              </g>
            )}
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
            <Rel kind={OUT} title={`${nodes[si].name} 의원이 대표발의한 법안에 자주 이름을 올린 의원`}
                 rows={out.map((e) => ({ i: e.b, both: mutual.has(e.b), text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
            <Rel kind={IN} title={`${nodes[si].name} 의원이 자주 이름을 올린 법안의 대표발의자`}
                 hint="그 의원의 상위 5명 안에 든 경우만"
                 rows={inc.map((e) => ({ i: e.a, both: mutual.has(e.a), text: `${e.nrep}건 중 ${e.n}건 (${e.share}%)` }))}
                 nodes={nodes} />
          </div>
        </div>
      )}
    </div>
  );
}

function KindLine({ kind, x1, y1, x2, y2, w }: {
  kind: Kind; x1: number; y1: number; x2: number; y2: number; w: number;
}) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={kind.color} strokeDasharray={kind.dash}
               strokeWidth={w} strokeLinecap="round" />;
}

function Swatch({ kind }: { kind: Kind }) {
  return (
    <svg width="22" height="10" aria-hidden className="shrink-0">
      <KindLine kind={kind} x1={1} y1={5} x2={21} y2={5} w={2.5} />
    </svg>
  );
}

function Rel({ kind, title, hint, rows, nodes }: {
  kind: Kind; title: string; hint?: string; rows: { i: number; both: boolean; text: string }[]; nodes: GraphNode[];
}) {
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0 sm:border-b-0 sm:odd:border-r">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold"><Swatch kind={kind} />{title}</h2>
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted">없습니다</p>
      ) : (
        <ul className="mt-1">
          {rows.map(({ i, both, text }) => (
            <li key={i} className="flex items-baseline gap-2">
              <button type="button" onClick={() => pick(nodes[i].code)}
                      className="min-h-9 text-left underline-offset-2 hover:underline">
                {nodes[i].name}
              </button>
              <span className="text-xs text-muted">{nodes[i].party}</span>
              {both && <span className="flex items-center gap-1 text-xs text-muted"><Swatch kind={BOTH} />서로</span>}
              <span className="ml-auto text-xs tabular-nums">{text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

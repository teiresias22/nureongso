/** 의원 페이지의 작은 차트들. 라이브러리 없이 서버에서 HTML·SVG 로 그린다.
 *
 *  규칙 (dataviz 지침):
 *  - 색은 globals.css 의 --viz-* 만 쓴다. 쌓인 막대에서 이웃하는 순서로 검증한 조합이다.
 *  - 이웃한 칸 사이는 테두리가 아니라 2px 틈(카드 배경)으로 가른다.
 *  - 글자는 데이터 색을 입지 않는다. 범례의 작은 네모가 색을 맡고 숫자는 글자색이다.
 *  - 모든 숫자는 범례·목록에 글자로도 있다(색이 안 보여도 읽힌다). 마크에 마우스를 올리면
 *    title 로 값이 뜬다.
 */

export type Part = { key: string; label: string; value: number; color: string };

/** 100% 누적 가로 막대 + 숫자 범례. 0 인 칸은 막대에서 빼고 범례에는 남긴다
 *  ('결석 0' 이 이 줄에서 가장 궁금한 숫자일 수 있다). */
export function StackBar({ parts, unit = "", ariaLabel, format }: {
  parts: Part[]; unit?: string; ariaLabel: string; format?: (v: number) => string;
}) {
  const fmt = format ?? ((v: number) => `${v.toLocaleString("ko-KR")}${unit}`);
  const total = parts.reduce((a, p) => a + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const share = (v: number) => (total ? (v / total) * 100 : 0);
  return (
    <div>
      <div role="img" aria-label={ariaLabel} className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        {shown.map((p) => (
          <div
            key={p.key}
            title={`${p.label} ${fmt(p.value)} (${share(p.value).toFixed(1)}%)`}
            style={{ width: `${share(p.value)}%`, background: p.color, minWidth: 3 }}
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
            {p.label}
            <b className="font-semibold text-foreground">{fmt(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 다른 의원들 사이에서 이 사람의 위치. 한 줄 위에 전원을 가는 눈금으로(회색),
 *  이 사람만 파란 점으로, 중간값을 긴 눈금으로 그린다 — '강조' 형식이다.
 *  순위를 매기지 않는다. 어디쯤인지만 보이면 된다.
 *
 *  SVG 가 아니라 퍼센트 위치의 HTML 이다. viewBox 는 비율을 지키느라 넓은 화면에서
 *  가운데 좁게 몰렸다(실측). 점이 찌그러지지 않으면서 폭을 다 쓰려면 이게 맞다. */
export function Strip({
  values, mine, domain, format, caption, lowLabel, highLabel,
}: {
  values: number[];
  mine: number;
  domain: [number, number];
  format: (v: number) => string;
  caption: string;
  lowLabel: string;
  highLabel: string;
}) {
  const [lo, hi] = domain;
  const x = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * 100;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : mine;
  return (
    <figure className="mt-2" role="img" aria-label={`${caption}. 이 의원 ${format(mine)}, 중간값 ${format(median)}`}>
      <div className="relative mx-1.5 h-6">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {values.map((v, i) => (
          <div key={i} className="absolute top-1.5 h-3 w-px" style={{ left: `${x(v)}%`, background: "var(--viz-peer)" }} />
        ))}
        <div className="absolute top-0 h-6 w-[1.5px] bg-muted" style={{ left: `${x(median)}%` }}
             title={`중간값 ${format(median)}`} />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
          style={{ left: `${x(mine)}%`, background: "var(--viz-1)", ["--tw-ring-color" as string]: "var(--card)" }}
          title={`이 의원 ${format(mine)}`}
        />
      </div>
      <figcaption className="mt-0.5 flex items-start justify-between gap-2 text-[11px] text-muted">
        <span className="shrink-0">{lowLabel}</span>
        <span className="text-center">
          {caption} · 이 의원 <b className="text-foreground">{format(mine)}</b> · 중간값 {format(median)}
        </span>
        <span className="shrink-0">{highLabel}</span>
      </figcaption>
    </figure>
  );
}

/** 연도별 순재산 세로 막대. 한 계열이라 범례가 없다(제목이 말한다).
 *  0 을 기준선으로 위는 파랑, 아래(빚이 더 많은 해)는 빨강. 값 라벨은 처음과 마지막만 —
 *  나머지는 아래 목록과 마우스 오버가 맡는다. Strip 과 같은 이유로 HTML 이다. */
export function Columns({
  points, format,
}: { points: { key: string; label: string; value: number; tip: string }[]; format: (v: number) => string }) {
  if (!points.length) return null;
  const maxV = Math.max(0, ...points.map((p) => p.value));
  const minV = Math.min(0, ...points.map((p) => p.value));
  const span = maxV - minV || 1;
  const zero = (maxV / span) * 100; // 기준선이 위에서 몇 % 인가
  const last = points.length - 1;
  return (
    <div role="img" aria-label={`순재산 추이: ${points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
      {/* 값 라벨 자리: 위쪽은 늘, 아래쪽은 음수 막대가 있을 때만 비운다(날짜 라벨과 겹쳤다). */}
      <div className={`relative mt-5 h-28 ${minV < 0 ? "mb-5" : ""}`}>
        <div className="absolute inset-x-0 h-px bg-line" style={{ top: `${zero}%` }} />
        <div className="absolute inset-0 flex">
          {points.map((p, i) => {
            const h = (Math.abs(p.value) / span) * 100;
            const up = p.value >= 0;
            return (
              <div key={p.key} className="relative flex-1" title={p.tip}>
                <div
                  className={`absolute left-1/2 w-[min(24px,60%)] -translate-x-1/2 ${up ? "rounded-t" : "rounded-b"}`}
                  style={{
                    top: up ? `${zero - h}%` : `${zero}%`,
                    height: `max(${h}%, 1px)`,
                    background: up ? "var(--viz-1)" : "var(--viz-neg)",
                  }}
                />
                {(i === 0 || i === last) && (
                  <span
                    className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold"
                    style={up ? { bottom: `${100 - zero + h}%`, marginBottom: 2 } : { top: `${zero + h}%`, marginTop: 2 }}
                  >
                    {format(p.value)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex">
        {points.map((p) => (
          <span key={p.key} className="flex-1 text-center text-[10px] text-muted">{p.label}</span>
        ))}
      </div>
    </div>
  );
}

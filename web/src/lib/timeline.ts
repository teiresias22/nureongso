/** 공약 상세(/pledge/[id])의 타임라인과 근거 버전 차이. 순수 계산이다.
 *  import 가 없어야 timeline.check.mjs 가 node 로 바로 읽는다. */

export type Facts = Record<string, unknown>;

/** happened = 일어난 날(선거·발의·처리·공포·공고), seen = 우리가 확인한 날(판정 이력·근거 버전). */
export type TEvent = { date: string; kind: "happened" | "seen"; text: string; href?: string };

export type LogRow = {
  at: string; status: string; note: string | null;
  prev_status: string | null; prev_note: string | null; reason: string;
};

export type TimelineInput = {
  election?: { date: string; label: string } | null;
  records?: { date: string | null; text: string; href?: string }[];
  log?: LogRow[];
  versions?: { ref: string; label: string; seen_at: string; facts: Facts }[];
  factLabel?: (key: string, v: unknown) => string;
};

/** 민선 9기 단체장·교육감 취임일. collector/judge.py HEAD_TERM_START 와 같아야 한다(test_judge 가 본다).
 *  근거 줄에 '취임일 전 기록' 을 사실로 달 때만 쓴다 — 판정은 웹에서 다시 계산하지 않는다. */
export const HEAD_TERM_START = "2026-07-01";

/** 검수 표시(pledge_evidence.review 'ok|reject|partial:YYYY-MM-DD[:llm]')를 근거 줄의 말로.
 *  끝에 ':llm' 이 붙으면 사람이 아니라 LLM 이 확인한 것이다(판정 계획 결정 T1.8). */
export function reviewText(review: string | null | undefined): string {
  if (!review) return "";
  const [kind, day = "", by = ""] = review.split(":");
  const label = { ok: "맞음", reject: "관련 없음(판정에 쓰지 않음)", partial: "일부만(진행까지)" }[kind] ?? kind;
  return `${by === "llm" ? "LLM 확인" : "사람 확인"}: ${label}${day ? ` ${day.slice(5).replace("-", ".")}` : ""}`;
}

/** 판정 이력의 사유. supabase/schema.sql log_pledge_status() 의 reason 과 1:1. */
export const REASON_LABEL: Record<string, string> = {
  baseline: "기록 시작 시점 판정",
  reviewer: "사람 검수",
  llm: "LLM 검수",
  evidence: "근거 연결",
  source: "출처 기록 변화",
  rule: "판정 기준 변경",
  elapsed: "기간 경과",
  input: "분류·대조 범위 변화",
};

/** 'YYYYMMDD'·'YYYY-MM-DD'·ISO 시각을 한국 날짜 'YYYY-MM-DD' 로. 서버는 UTC 라 시각은 9시간 당긴다. */
export function kstDate(v: string | null | undefined): string {
  if (!v) return "";
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? v.slice(0, 10) : new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
}

/** n일 전 시각(ISO). 인물 페이지의 '최근 30일 안에 바뀐 판정' 에 쓴다(kstYear 처럼 렌더 밖 도우미). */
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400e3).toISOString();

/** 인물 페이지 공약 줄의 'MM.DD 바뀜' / 'MM.DD 기준 변경'. 상태가 실제로 바뀐 줄만 센다(사유만 바뀐 줄은 아님).
 *  규칙 변경('rule')이 아닌 변화가 하나라도 있으면 가장 최근 그 줄의 날짜로 '바뀜', 'rule' 만 있으면 '기준 변경'.
 *  규칙 주에는 털어 내기·규칙 적용·정기 판정이 같은 날 줄을 여럿 남긴다 — rows 는 이력 id 순이어야 한다. */
export function changeMarks(
  rows: { pledge_id: number; at: string; status: string; prev_status: string | null; reason: string }[],
): Map<number, string> {
  const byRecord = new Map<number, string>();
  const byRule = new Map<number, string>();
  for (const r of rows) {
    if (r.prev_status == null || r.prev_status === r.status) continue;
    const day = kstDate(r.at).slice(5).replace("-", ".");
    (r.reason === "rule" ? byRule : byRecord).set(r.pledge_id, day);
  }
  const out = new Map<number, string>();
  for (const [id, day] of byRule) out.set(id, `${day} 기준 변경`);
  for (const [id, day] of byRecord) out.set(id, `${day} 바뀜`);
  return out;
}

/** 두 버전의 facts 에서 달라진 칸 [키, 이전, 지금]. 첫 버전이면(prev 없음) 비교하지 않는다. */
export function versionDiff(prev: Facts | null, cur: Facts): [string, unknown, unknown][] {
  if (!prev) return [];
  return [...new Set([...Object.keys(prev), ...Object.keys(cur)])]
    .sort()
    .filter((k) => JSON.stringify(prev[k] ?? null) !== JSON.stringify(cur[k] ?? null))
    .map((k) => [k, prev[k] ?? null, cur[k] ?? null]);
}

/** 날짜순. 같은 날은 일어난 일 → 확인한 일 순(확인은 그 일 뒤에 온다). */
export function timeline(i: TimelineInput): TEvent[] {
  const out: TEvent[] = [];
  if (i.election?.date) out.push({ date: kstDate(i.election.date), kind: "happened", text: i.election.label });
  for (const r of i.records ?? []) {
    if (r.date) out.push({ date: kstDate(r.date), kind: "happened", text: r.text, href: r.href });
  }
  for (const l of i.log ?? []) {
    const why = REASON_LABEL[l.reason] ?? l.reason;
    const text =
      l.prev_status == null
        ? `판정 ${l.status} · ${why}`
        : l.prev_status !== l.status
          ? `판정 ${l.prev_status} → ${l.status} · ${why}`
          : `판정 사유 바뀜(${l.status} 유지) · ${why}`;
    out.push({ date: kstDate(l.at), kind: "seen", text });
  }
  // 근거 기록의 버전은 같은 기록끼리 이어 본다. 첫 버전은 '처음 본 것' 이라 변화가 아니다.
  const last = new Map<string, Facts>();
  const fmt = i.factLabel ?? ((k: string, v: unknown) => `${k} ${v ?? "없음"}`);
  for (const v of [...(i.versions ?? [])].sort((a, b) => a.seen_at.localeCompare(b.seen_at))) {
    const d = versionDiff(last.get(v.ref) ?? null, v.facts);
    last.set(v.ref, v.facts);
    if (d.length)
      out.push({
        date: kstDate(v.seen_at),
        kind: "seen",
        text: `기록 변화 · ${v.label} · ${d.map(([k, a, b]) => `${fmt(k, a)} → ${fmt(k, b)}`).join(", ")}`,
      });
  }
  const rank = { happened: 0, seen: 1 };
  // 정렬은 안정적이라 같은 날·같은 종류는 넣은 순서(이력 id 순)를 지킨다.
  return out.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind]);
}

/** 공약 상세 쪽에 보일 것이 있는가. 없으면 의원 페이지가 링크하지 않고 공약 쪽은 검색에서 뺀다 —
 *  공약 본문은 의원 페이지에 이미 다 나오고, 판단불가·근거 없음·이력 없음이면 상세가 더할 게 없다.
 *  그런 쪽이 1.6만 개라 크롤러가 한 바퀴 돌 때마다 Vercel 무료 한도를 먹었다(2026-10). */
export function pledgeHasDetail(p: {
  status: string | null | undefined; note: string | null | undefined; evidenceCount: number; changed: boolean;
}): boolean {
  if (!p.status) return false;
  const evidence = p.note === "past_term" ? 0 : p.evidenceCount;
  return p.status !== "판단불가" || evidence > 0 || p.changed;
}

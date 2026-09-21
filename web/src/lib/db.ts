import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const db = createClient(url, key, { auth: { persistSession: false } });

export type Member = {
  code: string;
  name: string;
  office: string | null;
  party: string | null;
  district: string | null;
  elect_type: string | null;
  terms: string | null;
  term_count: string | null;
  committees: string | null;
  photo_url: string | null;
  homepage: string | null;
  is_incumbent: boolean;
};

/** 전부 SQL 에서 집계된 값. 클라이언트에서 행을 세면 PostgREST 의 1000행 상한에 걸린다. */
export type MemberStats = {
  code: string;
  is_incumbent?: boolean;
  office?: string | null;
  rep_count: number;
  co_count: number;
  rep_passed: number;
  rep_pending: number;
  vote_total: number;
  vote_yes: number;
  vote_no: number;
  vote_blank: number;
  vote_absent: number;
  pledge_count: number;
  pledge_done: number;
  pledge_judged: number;
  /** 입법형 공약 수. 나머지 유형은 아직 측정 수단이 없다. */
  pledge_law: number;
  pledge_law_filed: number;
  pledge_law_passed: number;
};

/** 공약 유형 = '무엇으로 이행을 확인할 수 있는가'. 주제 분류가 아니다. */
export const KIND_LABEL: Record<string, string> = {
  입법: "법률 제·개정",
  예산사업: "예산·사업",
  조례제도: "조례·제도",
  선언: "방향 제시",
  기타: "기타",
};

/** 판정 근거를 사람이 읽는 말로. judge.py 의 note 와 1:1. */
export const NOTE_LABEL: Record<string, string> = {
  law_passed: "발의한 법안이 통과됐습니다",
  law_filed: "관련 법안을 발의했습니다",
  law_none_2y: "임기 2년이 지났지만 관련 법안이 없습니다",
  law_none_early: "관련 법안이 아직 없습니다 (임기 2년 미만)",
};

export const noteText = (note?: string | null) => {
  if (!note) return "";
  if (note.startsWith("no_measure:")) {
    // judge.py 는 유형을 '+' 로 이어 붙인다. 예: no_measure:예산사업+조례제도
    const kinds = note.slice(11).split("+").map((k) => KIND_LABEL[k] ?? k).join(", ");
    return `법안으로는 확인할 수 없는 유형입니다 (${kinds})`;
  }
  return NOTE_LABEL[note] ?? note;
};

/** 직위가 아니라 실제 데이터 유무로 판단한다. 국회의원이었다가 단체장이 된 사람은
 *  한 인물로 합쳐지므로, 직위로 가르면 과거 발의 이력이 화면에서 사라진다. */
export const hasBills = (s?: Pick<MemberStats, "rep_count" | "co_count" | "vote_total">) =>
  !!s && s.rep_count + s.co_count + s.vote_total > 0;

export const hasPledges = (s?: Pick<MemberStats, "pledge_count">) => !!s && s.pledge_count > 0;

export type Bill = {
  bill_id: string;
  bill_no: string | null;
  name: string;
  committee: string | null;
  proposed_at: string | null;
  proc_result: string | null;
  proposer: string | null;
  detail_link: string | null;
};

export const PARTY_COLORS: Record<string, string> = {
  더불어민주당: "#152484",
  국민의힘: "#E61E2B",
  조국혁신당: "#0073CF",
  개혁신당: "#FF7210",
  진보당: "#D6001C",
  기본소득당: "#00D2C3",
  사회민주당: "#F58400",
};

export function partyColor(party?: string | null) {
  if (!party) return "#6b7280";
  const key = Object.keys(PARTY_COLORS).find((p) => party.includes(p));
  return key ? PARTY_COLORS[key] : "#6b7280";
}

/** "제21대, 제22대" 중 마지막 소속 정당만 (역대 데이터는 "A/B" 형태) */
export function lastPart(v?: string | null) {
  return v ? v.split("/").pop()!.trim() : "";
}

export function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

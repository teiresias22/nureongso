import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const db = createClient(url, key, { auth: { persistSession: false } });

export type Member = {
  code: string;
  name: string;
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
  rep_count: number;
  co_count: number;
  rep_passed: number;
  rep_pending: number;
  vote_total: number;
  vote_yes: number;
  vote_no: number;
  vote_blank: number;
  vote_absent: number;
};

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

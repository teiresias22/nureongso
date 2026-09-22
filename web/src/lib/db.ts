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
  term_count: string | null;
  photo_url: string | null;
  // 목록 화면은 이 칸들을 안 받는다(CARD_COLS). 있을 때만 있는 값이라 선택으로 둔다.
  terms?: string | null;
  committees?: string | null;
  homepage?: string | null;
  is_incumbent?: boolean;
};

/** 목록 카드가 실제로 쓰는 칸. 558행을 받는 화면에서 `select *` 를 하면 위원회
 *  이름 같은 긴 글이 통째로 따라와 쿼리가 349ms 에서 154ms 로 벌어진다(실측).
 *  화면에 안 쓰는 값은 받지 않는다. */
export const CARD_COLS =
  "code,name,party,district,office,elect_type,term_count,photo_url";
export const CARD_STAT_COLS =
  "code,rep_count,co_count,vote_total,vote_absent,pledge_count,pledge_done";
/** CARD_STAT_COLS 로 받은 행. 나머지 칸은 안 받았으니 타입에도 없다 —
 *  있다고 해두면 undefined 가 화면에 조용히 흘러나간다. */
export type CardStats = Pick<MemberStats,
  "code" | "rep_count" | "co_count" | "vote_total" | "vote_absent"
  | "pledge_count" | "pledge_done">;

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
  not_checked: "아직 법안을 대조하지 않았습니다",
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

/** 본회의 표결 참여율. 표결 기록이 아예 없으면 null 이다 — 0% 가 아니다.
 *
 *  임기 중 재보궐·승계로 들어온 의원은 국회 표결 API 의 명부에 아예 없다. 실측:
 *  한 법안의 표결 명부가 개원 때 300명에서 283명까지 줄기만 하고, 새로 들어온
 *  사람은 추가되지 않는다. 그래서 이 값은 채울 수가 없다.
 *
 *  그걸 0% 로 보이면 '한 번도 본회의에 안 나왔다' 로 읽힌다. 실제로 그 사람들은
 *  법안 발의는 수십~수백 건씩 하고 있다. 모르는 건 모른다고 적는다. */
export const attendRate = (s?: Pick<MemberStats, "vote_total" | "vote_absent">) =>
  s && s.vote_total > 0 ? pct(s.vote_total - s.vote_absent, s.vote_total) : null;

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

/** 직위 배지 색. 목록에 네 직위가 섞여 있어 글씨만으로는 한눈에 안 갈린다.
 *  정당색은 카드 왼쪽 막대가 이미 쓰고 있으므로 여기는 옅은 배경으로만 구분한다. */
export const OFFICE_BADGE: Record<string, string> = {
  국회의원: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  시도지사: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  구시군의장: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  교육감: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};
export const officeBadge = (office?: string | null) =>
  OFFICE_BADGE[office ?? "국회의원"] ?? "border-line text-muted";

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

/** 시도 이름을 통용 약칭으로. '전남광주통합특별시 서구갑' 같은 긴 지역구를 줄인다. */
const SIDO_SHORT: Record<string, string> = {
  경상남도: "경남", 경상북도: "경북", 전라남도: "전남", 전라북도: "전북",
  충청남도: "충남", 충청북도: "충북", 경기도: "경기", 강원도: "강원", 제주도: "제주",
};

export function shortDistrict(v?: string | null) {
  const d = lastPart(v);
  if (!d || d === "비례대표") return ""; // 비례대표는 배지로 이미 보인다
  const [head, ...rest] = d.split(" ");
  const bare = head.replace(/(특별자치시|특별자치도|특별시|광역시|자치도)$/, "");
  return [SIDO_SHORT[bare] ?? bare, ...rest].join(" ");
}

export function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/** 정당별·지역별 집계. 두 뷰가 같은 컬럼 구성이라 화면에서 한 컴포넌트로 다룬다. */
export type GroupStats = {
  office: string | null;
  name: string;
  members: number;
  rep_count: number;
  co_count: number;
  rep_passed: number;
  vote_total: number;
  vote_attended: number;
  pledge_count: number;
  pledge_law: number;
  pledge_law_filed: number;
  pledge_law_passed: number;
};

/** 선수와 득표율. 국회의원은 열린국회정보가 term_count 를 주지만 단체장·교육감은
 *  없어서 선관위 당선 이력을 센다. */
/** 출마 이력 한 줄. 낙선자도 들어 있다 (선관위 후보자 정보).
 *  득표수·득표율은 선관위 개표 정보에서 채운다. 등록 후 사퇴한 후보와 비례대표는
 *  개표에 줄이 없어 비어 있다. */
export type Candidacy = {
  id: number;
  election_id: string;
  sg_typecode: string | null;
  office: string | null;
  /** 시도명. district 만으로는 선거구가 안 정해진다 — '남구' 가 네 곳이다. */
  sd_name: string | null;
  district: string | null;
  party: string | null;
  giho: string | null;
  vote_rate: number | null;
  elected: boolean;
  member_code: string | null;
};

export type Rival = Pick<
  Candidacy,
  "id" | "election_id" | "sg_typecode" | "sd_name" | "district" | "party" | "giho"
  | "vote_rate" | "elected" | "member_code"
> & { name: string };

export type OfficeTerm = {
  member_code: string;
  office: string;
  wins: number;
  is_current?: boolean;
  last_election: string | null;
  last_vote_rate: number | null;
  last_district: string | null;
  first_election: string | null;
};

/** 1 → 초선, 2 → 재선, 3 이상 → N선. 국회 관행과 같은 표기. */
export const termLabel = (n?: number | null) =>
  !n ? "" : n === 1 ? "초선" : n === 2 ? "재선" : `${n}선`;

/** 선수 표기. 단체장·교육감은 두 개를 같이 적어야 뜻이 맞는다.
 *
 *  하나만 적으면 양쪽으로 틀린다. 국회 선수만 보이면 서울시장 5선인 오세훈이
 *  '초선'(16대 의원) 이 되고, 현재 직위 선수만 보이면 경기도지사 초선인 추미애가
 *  국회 6선이라는 사실이 사라진다. 해당자가 현직 20명이다.
 *
 *  국회의원은 국회 선수 하나면 된다 — 지금 직위가 곧 국회의원이다. */
export const termText = (
  office: string | null | undefined,
  wins?: number | null,
  mpCount?: string | null,
) =>
  (office ?? "국회의원") === "국회의원"
    ? mpCount ?? ""
    : [termLabel(wins), mpCount && `국회 ${mpCount}`].filter(Boolean).join(" · ");

/** 선거ID(YYYYMMDD) → '2026' */
export const electionYear = (id?: string | null) => (id ? id.slice(0, 4) : "");

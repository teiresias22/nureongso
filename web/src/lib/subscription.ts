/** 구독 신청 폼 읽기와 링크 토큰 모양. api/subscription/route.ts 가 쓴다.
 *  import 가 없어야 subscription.check.mjs 가 node 로 바로 읽는다. */
export type Parsed =
  | { ok: true; email: string; sd: string; wiw: string }
  | { ok: false; why: "bot" | "invalid" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseSubscribe(f: FormData, regions: Record<string, string[]>): Parsed {
  // 사람에게는 안 보이는 칸. 채워 왔으면 봇이다 — 받은 척만 한다.
  if (String(f.get("website") ?? "") !== "") return { ok: false, why: "bot" };
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const sd = String(f.get("sd") ?? "");
  const wiw = String(f.get("wiw") ?? "");
  // 지역은 /my 목록에 있는 값만. 확인 메일 제목·본문에 그대로 들어가서, 아무 글자나 받으면
  // 남의 주소로 광고 문구를 보내는 데 쓰인다.
  if (email.length > 254 || !EMAIL.test(email)) return { ok: false, why: "invalid" };
  if (!regions[sd] || (wiw !== "" && !regions[sd].includes(wiw))) return { ok: false, why: "invalid" };
  return { ok: true, email, sd, wiw };
}

/** 확인·해지 링크의 토큰(uuid). 모양이 틀리면 DB 까지 가지 않는다(uuid 변환 오류도 막는다). */
export const isToken = (t: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);

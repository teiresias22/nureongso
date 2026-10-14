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

/** 주간 기록 메일이 켜졌나. 셋이 다 있어야 켜진다 — 값이 비면 안 나가는 NAVER_SITE_VERIFICATION 과 같은 방식.
 *  운영 DB 에 구독 표를 적용하고 Resend 보내는 도메인을 확인한 뒤 Vercel 에 넣는다(docs/IMPROVEMENT_PROGRESS.md).
 *  service_role 키는 있는지만 본다. 값은 api/subscription/route.ts 밖에서 읽지 않는다. */
export const subscriptionOn = () =>
  !!(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.RESEND_API_KEY && process.env.MAIL_FROM);

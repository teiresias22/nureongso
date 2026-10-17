import { createClient } from "@supabase/supabase-js";

import { regionsOf, type Area } from "@/lib/area";
import { db } from "@/lib/db";
import { SITE } from "@/lib/site";
import { isToken, parseSubscribe, subscriptionOn } from "@/lib/subscription";

/** 주간 기록 메일 신청·확인·해지. 셋 다 POST 이고 결과는 /subscription 화면으로 303.
 *
 *  이 사이트의 유일한 쓰기 경로다. anon 키는 공개값이고 구독 표는 정책 없이 RLS 만 켰으므로
 *  service_role 키로 SQL 함수 셋만 부른다(supabase/schema.sql '주간 기록 메일: 구독').
 *  이 키는 이 파일 밖에서 읽지 않는다. 로그인이 없어 확인·해지 링크의 토큰이 곧 열쇠다.
 *  메일 앱의 '구독 해지' 단추도 여기로 바로 POST 한다(RFC 8058, 본문은 읽지 않는다). */
const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: Request) {
  const url = new URL(req.url);
  const act = url.searchParams.get("do");
  const back = (done: string) => Response.redirect(new URL(`/subscription?done=${done}`, req.url), 303);
  // 키가 다 들어오기 전(운영 DB 적용·Resend 도메인 확인 전)에는 꺼져 있다. /my 에 폼도 안 뜬다.
  if (!subscriptionOn()) return back("busy");

  if (act === "confirm" || act === "stop") {
    const t = url.searchParams.get("t") ?? "";
    if (!isToken(t)) return back("invalid");
    const fn = act === "confirm" ? "subscription_confirm" : "subscription_stop";
    const { data, error } = await admin().rpc(fn, { p_token: t });
    if (error) return back("busy");
    // 해지는 이미 지워진 것도 '해지됨' 이다. 메일 앱이 같은 요청을 두 번 보내기도 한다.
    if (act === "stop") return back("stopped");
    return back(data ? "confirmed" : "invalid");
  }
  if (act !== "subscribe") return back("invalid");

  // 1시간 데이터 캐시를 탄다(db.ts). /my 와 같은 목록이어야 거기서 고른 값이 통과한다.
  const { data: areas } = await db.from("member_area").select("member_code, office, sd_name, wiw_name");
  const f = parseSubscribe(await req.formData(), regionsOf((areas ?? []) as Area[]));
  if (!f.ok) return back(f.why === "bot" ? "sent" : "invalid");

  const { data: token, error } = await admin().rpc("subscription_request", {
    p_email: f.email, p_sd: f.sd, p_wiw: f.wiw,
  });
  // subscription_busy: 한 시간에 확인 메일 30통을 넘겼다(남의 주소로 메일을 쏘지 못하게).
  if (error) return back("busy");
  // token 이 없으면 이미 확인된 주소이거나 10분 안에 보낸 주소다. 어느 쪽인지 알려 주지 않는다.
  // 보내기가 실패하면 10분 뒤에 다시 신청할 수 있다(그 사이 confirm_sent_at 이 막는다).
  const area = [f.sd, f.wiw].filter(Boolean).join(" ");
  if (token && !(await sendConfirm(f.email, area, token))) return back("busy");
  return back("sent");
}

async function sendConfirm(email: string, area: string, token: string): Promise<boolean> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: [email],
      subject: `[누렁소검은소] ${area} 주간 기록 메일 구독 확인`,
      text: [
        `${area}의 국회의원·시도지사·구시군의장·교육감에 대해, 지난 한 주 새로 수집된 공개 기록`,
        `(대표발의 법안, 본회의 표결, 본회의 출결, 공약 판정)을 매주 월요일 아침 보내 드립니다.`,
        `기록이 없는 주에는 보내지 않습니다.`,
        ``,
        `아래 주소를 열고 '구독 확인'을 누르면 시작합니다(7일 안).`,
        `${SITE}/subscription?do=confirm&t=${token}`,
        ``,
        `신청하지 않았다면 이 메일을 무시하세요. 확인하지 않은 주소는 7일 뒤 지웁니다.`,
        `저장하는 것: 메일 주소, 고른 지역, 신청·확인 시각.`,
        `— 누렁소검은소 ${SITE}`,
      ].join("\n"),
    }),
  });
  return r.ok;
}

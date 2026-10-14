import Link from "next/link";

import { isToken } from "@/lib/subscription";

export const metadata = {
  title: "메일 구독",
  robots: { index: false, follow: false },
};

const DONE: Record<string, string> = {
  sent: "확인 메일을 보냈습니다. 메일의 링크를 열어 '구독 확인'을 눌러야 시작됩니다. 이미 확인된 주소에는 다시 보내지 않습니다.",
  confirmed: "구독을 확인했습니다. 다음 주 월요일부터, 고른 지역의 공개 기록이 새로 들어온 주에 메일을 보냅니다.",
  stopped: "구독을 해지했습니다. 메일 주소와 지역을 지웠습니다.",
  invalid: "링크나 입력이 맞지 않습니다. 확인 링크는 7일이 지나면 끊깁니다 — 내 지역 대표에서 다시 신청하세요.",
  busy: "지금은 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.",
};

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ do?: string; t?: string; done?: string }>;
}) {
  const q = await searchParams;
  const ask = (q.do === "confirm" || q.do === "stop") && isToken(q.t ?? "") ? q.do : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">주간 기록 메일</h1>
      {ask ? (
        // 링크를 여는 것만으로는 바꾸지 않는다. 메일 보안 검사기가 링크를 미리 열어 보는 일이 있어
        // 버튼(POST)을 한 번 누르게 한다. 메일 앱의 '구독 해지' 단추는 api 로 바로 POST 한다.
        <form
          method="post"
          action={`/api/subscription?do=${ask}&t=${q.t}`}
          className="space-y-3 rounded-lg border border-line bg-card p-6"
        >
          <p className="text-sm">
            {ask === "confirm" ? "주간 기록 메일 구독을 확인합니다." : "주간 기록 메일 구독을 해지하고 메일 주소를 지웁니다."}
          </p>
          <button className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
            {ask === "confirm" ? "구독 확인" : "구독 해지"}
          </button>
        </form>
      ) : (
        <p className="rounded-lg border border-line bg-card p-6 text-sm">{DONE[q.done ?? ""] ?? DONE.invalid}</p>
      )}
      <p className="text-xs text-muted">
        저장하는 것은 메일 주소, 고른 지역, 신청·확인 시각뿐입니다.{" "}
        <Link href="/my" className="underline underline-offset-2">
          내 지역 대표
        </Link>
      </p>
    </div>
  );
}

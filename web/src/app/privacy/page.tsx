import { pageOg } from "@/lib/site";

const TITLE = "개인정보처리방침";
const DESC = "누렁소검은소가 방문 통계를 위해 처리하는 정보와 그 처리 방식을 안내합니다.";

export const metadata = {
  title: TITLE,
  alternates: { canonical: "/privacy" },
  description: DESC,
  ...pageOg(`누렁소검은소 — ${TITLE}`, DESC, "/privacy"),
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10 leading-7">
      <h1 className="text-2xl font-bold">{TITLE}</h1>
      <p>
        누렁소검은소(이하 &lsquo;서비스&rsquo;)는 회원가입이 없고 이름·연락처 같은 개인정보를 받지 않습니다.
        다만 사이트가 얼마나 쓰이는지 알기 위해 아래와 같이 방문 통계를 수집합니다.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. 수집하는 정보와 목적</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>항목: 방문한 페이지 주소, 방문 일시, 기기·브라우저 종류, 대략적인 지역(국가·도시 수준), 유입 경로, 브라우저 쿠키에 저장되는 임의 식별자</li>
          <li>목적: 방문자 수와 많이 보는 페이지를 집계해 서비스를 개선하기 위함</li>
          <li>광고에 쓰지 않으며, 광고 개인화와 Google 신호 데이터 수집은 꺼 두었습니다.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. 처리 위탁 및 국외 이전</h2>
        <p>
          방문 통계는 Google LLC의 Google 애널리틱스(GA4)로 처리합니다. 수집된 정보는 Google의 서버(미국 등)로
          방문 시점에 전송·보관되며, 보관 기간은 14개월입니다. Google의 처리 방식은{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Google 개인정보처리방침
          </a>
          을 따릅니다.
        </p>
        <p>
          일부 방문 통계는 PostHog Inc.의 PostHog로도 처리합니다. 페이지 방문 기록과 익명 식별자가 PostHog의 서버(미국)로
          전송됩니다. 처리 방식은{" "}
          <a href="https://posthog.com/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            PostHog 개인정보처리방침
          </a>
          을 따릅니다.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. 수집을 원하지 않을 때</h2>
        <p>
          브라우저 설정에서 쿠키를 차단하거나,{" "}
          <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            Google 애널리틱스 차단 브라우저 부가기능
          </a>
          을 쓰면 수집되지 않습니다. 서비스 이용에는 영향이 없습니다.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. 문의</h2>
        <p>
          개인정보 관련 문의는{" "}
          <a href="https://joon.is-a.dev/contact?app=nureongso" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            문의 페이지
          </a>
          로 보내 주세요.
        </p>
      </section>

      <p className="text-sm text-muted">시행일: 2026년 10월 27일</p>
    </article>
  );
}

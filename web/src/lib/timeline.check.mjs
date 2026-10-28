// 실행: node web/src/lib/timeline.check.mjs  (Node 24 가 .ts 를 그대로 읽는다)
// 공약 상세의 타임라인: 날짜순, 같은 날은 일어난 일 → 확인한 일, 기준선은 '기록 시작 시점'.
import assert from "node:assert";
import { changeMarks, kstDate, pledgeHasDetail, REASON_LABEL, reviewText, timeline, versionDiff } from "./timeline.ts";

assert.equal(kstDate("20261101"), "2026-11-01");
assert.equal(kstDate("2026-09-14"), "2026-09-14");
// 서버는 UTC 다. UTC 10월 18일 20시는 한국 10월 19일 새벽.
assert.equal(kstDate("2026-10-18T20:00:00+00:00"), "2026-10-19");

assert.deepStrictEqual(versionDiff({ name: "주차장법", proc_result: null }, { name: "주차장법", proc_result: "대안반영폐기" }), [
  ["proc_result", null, "대안반영폐기"],
]);
assert.deepStrictEqual(versionDiff(null, { proc_result: "가결" }), []);

const ev = timeline({
  election: { date: "20260603", label: "공약 (선거공약서)" },
  records: [
    { date: "2026-09-14", text: "공사 입찰 공고 · ○○동 공영주차장 건립공사", href: "https://example.com/bid" },
    { date: "20261019", text: "조례 일부개정 공포 · 서구 주차장 조례" },
    { date: null, text: "날짜 없는 기록은 싣지 않는다" },
  ],
  log: [
    { at: "2026-10-18T20:05:00+00:00", status: "판단불가", note: "none_early", prev_status: null, prev_note: null, reason: "baseline" },
    { at: "2026-10-25T20:05:00+00:00", status: "진행", note: "bid_ordered", prev_status: "판단불가", prev_note: "none_early", reason: "evidence" },
    { at: "2026-11-01T20:05:00+00:00", status: "진행", note: "law_filed", prev_status: "진행", prev_note: "bid_ordered", reason: "evidence" },
  ],
  versions: [
    { ref: "bill:B1", label: "주차장법", seen_at: "2026-10-18T20:00:00+00:00", facts: { proc_result: null } },
    { ref: "bill:B1", label: "주차장법", seen_at: "2026-12-06T20:00:00+00:00", facts: { proc_result: "대안반영폐기" } },
  ],
});
assert.deepStrictEqual(
  ev.map((e) => `${e.date} ${e.kind} ${e.text}`),
  [
    "2026-06-03 happened 공약 (선거공약서)",
    "2026-09-14 happened 공사 입찰 공고 · ○○동 공영주차장 건립공사",
    // 같은 날: 공포(일어난 일)가 기준선(확인한 일)보다 위
    "2026-10-19 happened 조례 일부개정 공포 · 서구 주차장 조례",
    `2026-10-19 seen 판정 판단불가 · ${REASON_LABEL.baseline}`,
    "2026-10-26 seen 판정 판단불가 → 진행 · 근거 연결",
    "2026-11-02 seen 판정 사유 바뀜(진행 유지) · 근거 연결",
    "2026-12-07 seen 기록 변화 · 주차장법 · proc_result 없음 → proc_result 대안반영폐기",
  ],
);
assert.equal(ev[1].href, "https://example.com/bid");
// 인물 페이지 'MM.DD 바뀜' / '기준 변경'. 규칙 주에는 같은 날 털어 내기(input)와 규칙 적용(rule) 줄이 같이 생긴다.
const marks = changeMarks([
  { pledge_id: 1, at: "2026-10-25T20:05:00+00:00", status: "진행", prev_status: "판단불가", reason: "input" },
  { pledge_id: 1, at: "2026-10-25T20:06:00+00:00", status: "판단불가", prev_status: "진행", reason: "rule" },
  { pledge_id: 2, at: "2026-10-25T20:06:00+00:00", status: "판단불가", prev_status: "진행", reason: "rule" },
  { pledge_id: 3, at: "2026-10-25T20:06:00+00:00", status: "진행", prev_status: "진행", reason: "rule" },  // 사유만
]);
assert.equal(marks.get(1), "10.26 바뀜");      // 기록 변화가 있으면 그것을 적는다
assert.equal(marks.get(2), "10.26 기준 변경"); // 규칙 변경만
assert.equal(marks.has(3), false);             // 상태가 그대로면 표시 없음
// 검수 표시: 끝에 ':llm' 이 붙으면 LLM 확인(판정 계획 T1.8)
assert.equal(reviewText("reject:2026-10-19"), "사람 확인: 관련 없음(판정에 쓰지 않음) 10.19");
assert.equal(reviewText("partial:2026-10-19:llm"), "LLM 확인: 일부만(진행까지) 10.19");

// 공약 상세가 있는가 — 의원 페이지 링크와 공약 페이지 noindex 가 같이 쓴다.
const thin = { status: "판단불가", note: "no_measure:예산사업", evidenceCount: 0, changed: false };
assert.equal(pledgeHasDetail(thin), false);
assert.equal(pledgeHasDetail({ ...thin, status: "진행" }), true);
assert.equal(pledgeHasDetail({ ...thin, status: "미착수" }), true);
assert.equal(pledgeHasDetail({ ...thin, evidenceCount: 1 }), true);
assert.equal(pledgeHasDetail({ ...thin, changed: true }), true);
// 지난 임기의 예전 근거는 화면에 싣지 않으니 상세가 있는 것으로 치지 않는다.
assert.equal(pledgeHasDetail({ ...thin, note: "past_term", evidenceCount: 3 }), false);
assert.equal(pledgeHasDetail({ ...thin, note: "past_term", evidenceCount: 3, changed: true }), true);
// 아직 판정이 없는 공약(상태 행 없음)은 상세가 없다.
assert.equal(pledgeHasDetail({ status: null, note: null, evidenceCount: 0, changed: false }), false);

console.log("timeline ok");

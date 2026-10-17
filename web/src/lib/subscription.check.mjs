// 실행: node web/src/lib/subscription.check.mjs  (Node 24 가 .ts 를 그대로 읽는다)
// 구독 신청 폼 검사와 /my 의 시도·시군구 목록. 지역은 목록에 있는 값만 받아야 확인 메일 제목에
// 남의 글을 싣지 못한다.
import assert from "node:assert";
import { regionsOf, sido } from "./area.ts";
import { isToken, parseSubscribe } from "./subscription.ts";

// 비례대표('전국')는 빠지고, 광주·전남은 통합 이름 하나로 묶인다. 시군구는 가나다순.
const regions = regionsOf([
  { member_code: "a", office: "국회의원", sd_name: "대구광역시", wiw_name: "서구" },
  { member_code: "b", office: "구시군의장", sd_name: "대구광역시", wiw_name: "달서구" },
  { member_code: "c", office: "국회의원", sd_name: "전국", wiw_name: null },
  { member_code: "d", office: "시도지사", sd_name: "광주광역시", wiw_name: null },
  { member_code: "e", office: "구시군의장", sd_name: "전라남도", wiw_name: "순천시" },
]);
assert.deepStrictEqual(regions, { 대구광역시: ["달서구", "서구"], 전남광주통합특별시: ["순천시"] });
assert.equal(sido(null), "");
assert.equal(sido("전라남도"), "전남광주통합특별시");

const form = (o) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const ok = { email: "a@example.com", sd: "대구광역시", wiw: "" };

assert.deepStrictEqual(
  parseSubscribe(form({ email: " Me@Example.COM ", sd: "대구광역시", wiw: "서구" }), regions),
  { ok: true, email: "me@example.com", sd: "대구광역시", wiw: "서구" },
);
assert.deepStrictEqual(parseSubscribe(form(ok), regions), { ok: true, ...ok }); // 시도 전체
// 목록에 없는 지역
assert.deepStrictEqual(parseSubscribe(form({ ...ok, sd: "광고 보러 오세요" }), regions), { ok: false, why: "invalid" });
assert.deepStrictEqual(parseSubscribe(form({ ...ok, wiw: "북구" }), regions), { ok: false, why: "invalid" });
// 메일 주소 모양·길이
assert.deepStrictEqual(parseSubscribe(form({ ...ok, email: "not-an-email" }), regions), { ok: false, why: "invalid" });
assert.deepStrictEqual(parseSubscribe(form({ ...ok, email: `${"a".repeat(250)}@example.com` }), regions), { ok: false, why: "invalid" });
// 사람에게 안 보이는 칸을 채운 봇
assert.deepStrictEqual(parseSubscribe(form({ ...ok, website: "x" }), regions), { ok: false, why: "bot" });

assert(isToken("3f2504e0-4f89-11d3-9a0c-0305e82c3301"));
assert(!isToken("3f2504e0") && !isToken("' or 1=1 --") && !isToken(""));
console.log("subscription ok");

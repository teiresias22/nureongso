// 실행: node src/lib/force.check.mjs  (Node 24 가 .ts 를 그대로 읽는다)
// 다섯 점짜리 덩어리 둘이 선 하나로만 이어진 그래프. 덩어리 안이 덩어리 사이보다 가까워야 한다.
import assert from "node:assert";
import { forceLayout } from "./force.ts";

const links = [];
for (const base of [0, 5])
  for (let a = base; a < base + 5; a++) for (let b = a + 1; b < base + 5; b++) links.push([a, b]);
links.push([4, 5]);

const { pos: p, height } = forceLayout(10, links);
assert(p.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1000 && y >= 0 && y <= height));
const d = (i, j) => Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]);
const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const inside = mean([[0, 1], [1, 2], [2, 3], [5, 6], [6, 7], [7, 8]].map(([i, j]) => d(i, j)));
const across = mean([[0, 9], [1, 8], [2, 7], [3, 6]].map(([i, j]) => d(i, j)));
assert(inside < across / 2, `덩어리 안 ${inside} / 사이 ${across}`);
assert.deepStrictEqual(forceLayout(10, links).pos, p, "같은 입력이면 같은 그림");
// 겹친 점에서 0 으로 나누지 않는다.
assert(forceLayout(3, [[0, 1]], 1000, 1).pos.flat().every(Number.isFinite));
console.log("force ok");

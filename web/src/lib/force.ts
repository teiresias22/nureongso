/** 힘 배치(Fruchterman–Reingold). 선으로 이어진 점끼리는 끌리고, 모든 점은 서로 밀어낸다.
 *  가로가 size 이고, 세로는 그림에 맞춘 height 를 함께 돌려준다(가로로 긴 그림).
 *
 *  무작위를 쓰지 않는다. 시작 위치가 원 위에 순서대로 놓여 같은 데이터면 늘 같은 그림이
 *  나온다 — 하루 사이 수집이 바뀌지 않았는데 그림이 뒤집히면 무엇이 달라졌는지 읽을 수 없다.
 *  부르는 쪽이 정당 순으로 넘기면 같은 당이 가까이서 출발한다.
 *
 *  ponytail: 모든 쌍을 매번 계산하는 O(n²). 현직 299명·300회면 서버에서 수십 ms 라 충분하다.
 *  점이 수천이 되면 d3-force(Barnes–Hut)로 바꾼다. */
export function forceLayout(n: number, links: [number, number][], size = 1000, iters = 300) {
  const k = Math.sqrt((size * size) / Math.max(n, 1)) * 1.2; // 이상적인 점 사이 거리
  const pos = Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return [size / 2 + (size / 3) * Math.cos(t), size / 2 + (size / 3) * Math.sin(t)];
  });
  let temp = size / 10;
  for (let it = 0; it < iters; it++) {
    const disp = pos.map(() => [0, 0]);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i][0] - pos[j][0], dy = pos[i][1] - pos[j][1];
        const d2 = dx * dx + dy * dy;
        // 멀리 있는 점끼리는 밀지 않는다. 다 밀면 두 큰 당이 서로를 화면 양 끝으로 밀어내
        // 가운데가 텅 비고 각 당은 점 크기만 한 덩어리로 뭉쳤다(2026-10 실측).
        if (d2 > 9 * k * k) continue;
        const f = (k * k) / Math.max(d2, 0.01); // 크기 k²/d 를 단위벡터에 곱한 것
        disp[i][0] += dx * f; disp[i][1] += dy * f;
        disp[j][0] -= dx * f; disp[j][1] -= dy * f;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1];
      const f = Math.hypot(dx, dy) / k; // 크기 d²/k
      disp[a][0] -= dx * f; disp[a][1] -= dy * f;
      disp[b][0] += dx * f; disp[b][1] += dy * f;
    }
    for (let i = 0; i < n; i++) {
      // 가운데로 당긴다. 선이 적은 점이 멀리 떠 있으면 맞춰 줄일 때 나머지가 뭉친다.
      disp[i][0] += (size / 2 - pos[i][0]) * 0.15;
      disp[i][1] += (size / 2 - pos[i][1]) * 0.15;
      const d = Math.hypot(disp[i][0], disp[i][1]);
      if (d > 0) {
        const s = Math.min(d, temp) / d;
        pos[i][0] += disp[i][0] * s;
        pos[i][1] += disp[i][1] * s;
      }
    }
    temp = Math.max(temp * 0.985, 0.5);
  }
  // 가장 길게 퍼진 방향을 가로로 돌린다(주성분). 그림이 어느 쪽으로 길어질지는 시작 위치에
  // 달려 있는데, 세로로 길게 나오면 넓은 화면의 오른쪽 40% 가 비었다.
  const cx = pos.reduce((a, p) => a + p[0], 0) / n, cy = pos.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pos) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
  const th = -0.5 * Math.atan2(2 * sxy, sxx - syy), cos = Math.cos(th), sin = Math.sin(th);
  for (const p of pos) {
    const [x, y] = [p[0] - cx, p[1] - cy];
    p[0] = x * cos - y * sin; p[1] = x * sin + y * cos;
  }
  // 가로를 size 에 맞추고 세로는 같은 비율로 — 따로 늘리면 거리가 뜻을 잃는다.
  const pad = size * 0.03;
  const xs = pos.map((p) => p[0]), ys = pos.map((p) => p[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const s = (size - 2 * pad) / Math.max(Math.max(...xs) - x0, 1);
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    pos: pos.map(([x, y]) => [r(pad + (x - x0) * s), r(pad + (y - y0) * s)] as [number, number]),
    height: Math.ceil(2 * pad + (Math.max(...ys) - y0) * s),
  };
}

/** 이름표 크기. 한글은 한 글자 폭이 글자 크기와 거의 같다. */
export const LABEL_FONT = 13;
export const labelBox = (name: string): [number, number] => [name.length * LABEL_FONT + 10, LABEL_FONT + 8];

/** 겹친 이름표를 떼어 놓는다. 겹친 쌍마다 덜 겹친 축으로 반씩 민다. pos 를 고친다.
 *  돌려주는 것은 그림 전체를 담는 viewBox [x, y, w, h].
 *
 *  힘 배치만으로는 299명 중 233명의 이름이 서로 겹쳤다(2026-10 실측). 배치를 850 폭으로
 *  잡고 이걸 돌리면 겹침 0, 폭 약 965 가 된다.
 *  ponytail: 쌍마다 보는 O(n²)·최대 200회. 299명에 수십 ms. */
export function separate(pos: [number, number][], boxes: [number, number][], passes = 200) {
  for (let p = 0; p < passes; p++) {
    let moved = false;
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1];
        const ox = (boxes[i][0] + boxes[j][0]) / 2 - Math.abs(dx);
        const oy = (boxes[i][1] + boxes[j][1]) / 2 - Math.abs(dy);
        if (ox <= 0.5 || oy <= 0.5) continue;
        moved = true;
        if (ox / (boxes[i][0] + boxes[j][0]) < oy / (boxes[i][1] + boxes[j][1])) {
          const s = ((dx >= 0 ? 1 : -1) * ox) / 2;
          pos[i][0] -= s; pos[j][0] += s;
        } else {
          const s = ((dy >= 0 ? 1 : -1) * oy) / 2;
          pos[i][1] -= s; pos[j][1] += s;
        }
      }
    }
    if (!moved) break;
  }
  const r = (v: number) => Math.round(v * 10) / 10;
  for (const p of pos) { p[0] = r(p[0]); p[1] = r(p[1]); }
  const x0 = Math.min(...pos.map((p, i) => p[0] - boxes[i][0] / 2)) - 4;
  const y0 = Math.min(...pos.map((p, i) => p[1] - boxes[i][1] / 2)) - 4;
  const x1 = Math.max(...pos.map((p, i) => p[0] + boxes[i][0] / 2)) + 4;
  const y1 = Math.max(...pos.map((p, i) => p[1] + boxes[i][1] / 2)) + 4;
  return [Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0), Math.ceil(y1 - y0)] as const;
}

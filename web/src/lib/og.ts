/** OG 카드용 한글 폰트.
 *
 * satori(ImageResponse)는 글꼴을 직접 줘야 한글을 그린다. 전체 한글 TTF 는 수 MB 라
 * 매번 받을 수 없어서, 카드에 실제로 쓰이는 글자만 구글 폰트에 요청해 잘라 받는다.
 * 49자에 10KB 수준이라 가볍다.
 */
const FAMILY = "Noto Sans KR";
const cache = new Map<string, ArrayBuffer>();

export async function koreanFont(text: string, weight = 700): Promise<ArrayBuffer> {
  const chars = [...new Set(text)].sort().join("");
  const key = `${weight}:${chars}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(FAMILY)}` +
    `:wght@${weight}&text=${encodeURIComponent(chars)}`;
  // 최신 브라우저 UA 를 보내면 woff2 를 준다. satori 는 ttf 가 가장 안전하다.
  const css = await fetch(cssUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible)" },
    next: { revalidate: 86400 },
  }).then((r) => r.text());

  const url = css.match(/url\((https:\/\/[^)]+)\)/)?.[1];
  if (!url) throw new Error(`폰트 URL 을 못 찾았습니다: ${css.slice(0, 120)}`);

  const data = await fetch(url, { next: { revalidate: 86400 } }).then((r) => r.arrayBuffer());
  cache.set(key, data);
  return data;
}

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

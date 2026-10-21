import codes from "./photos.json";

/** 미리 줄인 사진이 있는 의원(collector/photos.py 가 만든다). */
const READY = new Set<string>(codes);

/** 사진 주소. 미리 줄인 정적 파일(public/photo, 160×192)이 있으면 그걸 변환 없이 쓰고,
 *  없으면(새 의원 등) 원본을 Vercel 이미지 변환으로 줄인다. 변환은 무료 5천 건이라
 *  역대 의원 3천여 명을 크롤러가 돌 때 한도가 찼다(2026-10). */
export function photo(code: string, url: string | null | undefined) {
  if (!url) return null;
  return READY.has(code)
    ? { src: `/photo/${code}.webp`, unoptimized: true }
    : { src: url, unoptimized: false };
}

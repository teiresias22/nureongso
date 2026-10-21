#!/usr/bin/env python3
"""의원 사진을 미리 줄여 web/public/photo/<code>.webp 로 둔다.

화면은 사진을 48·80px 칸에 그린다. 원본(국회 PNG 는 1MB 까지)을 Vercel 이미지 변환으로 줄이면
변환 한 번이 무료 5천 건에서 빠지는데, 크롤러가 법안 쪽의 발의자 링크로 역대 의원 3천여 명을
돌자 2026-10 에 한도가 찼다. 160×192(80×96 칸의 2배) WebP 한 벌이면 장당 3KB 안팎이고,
public 의 정적 파일이라 변환도 함수도 안 탄다.

사용:
    python photos.py            # 없는 것·주소가 바뀐 것만 받는다
    python photos.py --all      # 전부 다시

환경변수: DATABASE_URL

결과를 함께 커밋한다.
- web/public/photo/<code>.webp
- web/src/lib/photos.json   정적 파일이 있는 code 목록. 웹은 여기 있는 사람만 정적 파일로 그리고(lib/photo.ts),
  없으면 예전처럼 원본 주소를 변환해서 그린다. 그래서 새 의원이 생겨도 이걸 다시 돌리기 전까지 깨지지 않는다.
- collector/data/photos.json {code: 원본 주소}. 주소가 바뀐 사람만 다시 받으려고 둔다(웹 번들에 넣기엔 커서 따로).
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import psycopg
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web/public/photo"
CODES = ROOT / "web/src/lib/photos.json"
MANIFEST = ROOT / "collector/data/photos.json"
SIZE = (160, 192)


def shrink(data: bytes) -> bytes:
    im = Image.open(io.BytesIO(data)).convert("RGB")
    # 증명사진이라 얼굴이 위쪽에 있다. 가운데 기준으로 자르면 정수리가 잘린다.
    im = ImageOps.fit(im, SIZE, method=Image.Resampling.LANCZOS, centering=(0.5, 0.3))
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=75, method=6)
    return buf.getvalue()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--all", action="store_true")
    a = p.parse_args()

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute(
            "select code, photo_url from member where photo_url is not null order by code"
        ).fetchall()

    old = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    todo = [(c, u) for c, u in rows
            if a.all or old.get(c) != u or not (OUT / f"{c}.webp").exists()]
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"[photos] {len(rows)}명 중 {len(todo)}명 받는다", file=sys.stderr)

    done: dict[str, str] = {}
    failed: list[str] = []
    with httpx.Client(timeout=30, follow_redirects=True) as http:
        def one(item: tuple[str, str]) -> None:
            code, url = item
            try:
                r = http.get(url)
                r.raise_for_status()
                (OUT / f"{code}.webp").write_bytes(shrink(r.content))
                done[code] = url
            except Exception as e:  # 사진 하나 실패로 나머지를 버리지 않는다. 그 사람은 원본 변환으로 남는다.
                failed.append(f"{code} {url} {e}")

        # 원본 서버(국회·선관위)에 부담을 덜 주려고 동시 요청을 적게 둔다.
        with ThreadPoolExecutor(4) as pool:
            list(pool.map(one, todo))

    # 주소가 바뀌었는데 이번에 못 받은 사람은 옛 파일을 지운다 — 다른 사람 사진이 남지 않게.
    current = dict(rows)
    manifest = {c: u for c, u in old.items()
                if current.get(c) == u and (OUT / f"{c}.webp").exists()}
    manifest.update(done)
    for f in OUT.glob("*.webp"):
        if f.stem not in manifest:
            f.unlink()
    MANIFEST.write_text(json.dumps(dict(sorted(manifest.items())), ensure_ascii=False, indent=0) + "\n")
    CODES.write_text(json.dumps(sorted(manifest), separators=(",", ":")) + "\n")

    for line in failed:
        print(f"[photos] 실패 {line}", file=sys.stderr)
    print(f"[photos] 받음 {len(done)} · 실패 {len(failed)} · 목록 {len(manifest)}", file=sys.stderr)


if __name__ == "__main__":
    main()

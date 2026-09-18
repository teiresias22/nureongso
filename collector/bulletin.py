#!/usr/bin/env python3
"""선거공보 수집기 — 정책·공약마당(policy.nec.go.kr)의 선거공보 PDF.

선거공약 API 는 공약서 제출 대상 직위(대통령/시도지사/구시군의장/교육감)의 '대표공약'
5~10개만 준다. 후보의 전체 공약은 선거공보 PDF 에만 있고, 국회의원·지방의원은
아예 공약서 제출 대상이 아니라 이 경로가 유일하다.

사용:
    python bulletin.py list  --sg 20240410 --type 2   # 목록만 확인
    python bulletin.py fetch --sg 20240410 --type 2   # PDF 받아 텍스트 추출까지
    python bulletin.py fetch --sg 20240410 --type 2 --limit 5

환경변수: DATABASE_URL

공개 API 가 아니라 웹 화면이 쓰는 내부 엔드포인트다. 화면 구조가 바뀌면 깨진다.
그래서 응답 형태가 예상과 다르면 조용히 넘기지 않고 멈춘다.
"""
from __future__ import annotations

import argparse
import io
import os
import sys
import time

import httpx
import psycopg

ORIGIN = "https://policy.nec.go.kr"
LIST_URL = f"{ORIGIN}/plc/commiment/initUELCommimentListPresident.do"
DOWN_URL = f"{ORIGIN}/plc/common/downloadFile.do"
REFERER = f"{ORIGIN}/plc/commiment/initUELCommiment.do?menuId=WINNR2"

# fileinfo 는 "종류||경로||텍스트ID||제출여부||표시", 항목 사이는 콤마.
DOC_BULLETIN = "선거공보"


def client() -> httpx.Client:
    return httpx.Client(
        timeout=120,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": REFERER,
        },
    )


def list_docs(c: httpx.Client, sg_id: str, sg_type: str) -> list[dict]:
    """해당 선거·직위의 당선인별 제출 문서 목록."""
    out: list[dict] = []
    page = 1
    while True:
        r = c.post(LIST_URL, data={
            "sgId": sg_id, "subSgId": f"{sg_type}{sg_id}",
            "pageIndex": page, "hSggId": "ALL", "chkSgTypecode": sg_type,
        })
        r.raise_for_status()
        data = r.json()
        if "totalCnt" not in data:
            raise RuntimeError(f"목록 응답 형태가 바뀌었습니다: {list(data)[:5]}")
        rows = data.get("list") or []
        out.extend(rows)
        total = data["totalCnt"]
        print(f"  목록 {len(out)}/{total}", file=sys.stderr)
        if not rows or len(out) >= total:
            break
        page += 1
    return out


def bulletin_path(row: dict) -> str | None:
    """fileinfo 에서 선거공보 PDF 경로를 꺼낸다. 미제출이면 None."""
    info = row.get("fileinfo") or ""
    for part in info.split(","):
        f = part.split("||")
        if f and f[0].strip() == DOC_BULLETIN:
            path = f[1].strip() if len(f) > 1 else ""
            return path or None
    return None


def download(c: httpx.Client, path: str, name: str) -> bytes:
    """CDN(cdn.nec.go.kr)은 국내 전용이라 밖에서 안 뚫린다. 사이트 자체 다운로드를 쓴다."""
    r = c.get(DOWN_URL, params={"requestedFileName": name, "requestedFullPath": path})
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise RuntimeError(f"PDF 가 아닙니다 ({len(r.content)}바이트): {path}")
    return r.content


def extract_text(pdf: bytes) -> str:
    import pdfplumber  # 무거워서 필요할 때만

    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        text = "\n".join((p.extract_text() or "") for p in doc.pages)
    # 일부 공보에는 NUL 이 섞여 있다. Postgres text 는 NUL 을 못 담아 insert 가 죽는다.
    return text.replace("\x00", "").strip()


def ingest(conn, sg_id: str, sg_type: str, limit: int | None, skip_done: bool) -> None:
    with client() as c:
        rows = list_docs(c, sg_id, sg_type)

    with conn.cursor() as cur:
        cur.execute(
            "select huboid, member_code from candidacy"
            " where election_id = %s and sg_typecode = %s and member_code is not null",
            (sg_id, sg_type),
        )
        by_hubo = dict(cur.fetchall())
        cur.execute(
            "select member_code from pledge_doc"
            " where election_id = %s and raw_text is not null", (sg_id,)
        )
        done = {r[0] for r in cur.fetchall()}

    todo = []
    unmatched = 0
    for r in rows:
        path = bulletin_path(r)
        mcode = by_hubo.get(str(r.get("huboid")))
        if not path:
            continue
        if not mcode:
            unmatched += 1
            continue
        if skip_done and mcode in done:
            continue
        todo.append((mcode, path, r))

    print(f"  대상 {len(todo)}명 (미제출·이미받음 제외, 인물 매칭 실패 {unmatched}명)",
          file=sys.stderr)
    if unmatched:
        print("  ! 매칭 실패는 해당 선거의 당선인을 먼저 수집해야 합니다:"
              f" nec.py winners (sgId={sg_id}, sgTypecode={sg_type})", file=sys.stderr)
    if limit:
        todo = todo[:limit]

    ok = fail = 0
    with client() as c:
        for i, (mcode, path, r) in enumerate(todo, 1):
            name = f"{sg_id}_{r.get('sggname')}_{r.get('hbjname')}_선거공보.pdf"
            url = f"{DOWN_URL}?requestedFileName={name}&requestedFullPath={path}"
            try:
                pdf = download(c, path, name)
                text = extract_text(pdf)
            except Exception as e:
                fail += 1
                print(f"  [{i}/{len(todo)}] {r.get('hbjname')} 실패: {str(e)[:90]}",
                      file=sys.stderr)
                continue

            with conn.cursor() as cur:
                cur.execute(
                    "insert into pledge_doc (member_code, election_id, pdf_url, raw_text,"
                    " parsed_at) values (%s,%s,%s,%s,null)"
                    " on conflict (member_code, election_id) do update set"
                    "   pdf_url = excluded.pdf_url, raw_text = excluded.raw_text",
                    (mcode, sg_id, url, text),
                )
            conn.commit()
            ok += 1
            if i % 10 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] 성공 {ok} 실패 {fail}", file=sys.stderr)
            time.sleep(0.4)  # 공개 API 가 아니므로 천천히

    print(f"[bulletin] {sg_id}/{sg_type}: 저장 {ok}, 실패 {fail}", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["list", "fetch"])
    p.add_argument("--sg", required=True, help="선거ID (선거일 YYYYMMDD)")
    p.add_argument("--type", required=True, help="선거종류코드 (2=국회의원, 3=시도지사 ...)")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--redo", action="store_true", help="이미 받은 것도 다시 받는다")
    a = p.parse_args()

    if a.step == "list":
        with client() as c:
            rows = list_docs(c, a.sg, a.type)
        have = sum(1 for r in rows if bulletin_path(r))
        print(f"당선인 {len(rows)}명 중 선거공보 제출 {have}명")
        for r in rows[:5]:
            print(f"  {r.get('hbjname')} {r.get('sggname')} -> {bulletin_path(r)}")
        return

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        ingest(conn, a.sg, a.type, a.limit, skip_done=not a.redo)


if __name__ == "__main__":
    main()

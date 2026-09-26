#!/usr/bin/env python3
"""국회의원 재산공개 수집기 — 국회공보의 재산공개 호(號) PDF.

공직자윤리법 제10조에 따라 국회공직자윤리위원회가 해마다 3월 말 정기재산변동을,
총선이 있는 해 8월 말 신규등록·퇴직의원 재산을 국회공보로 공개한다. 선거공보의
재산신고와 달리 선거가 끝나도 내려가지 않는다.

사용:
    python asset.py list                 # 대상 공보 목록만
    python asset.py fetch                # 받아서 적재 (이미 받은 호는 건너뜀)
    python asset.py fetch --redo         # 전부 다시
    python asset.py relink               # 의원 연결만 다시 (적재 후 자동으로도 돈다)
    python asset.py dump --out a.json    # DB 없이 파싱 결과만 파일로

환경변수: DATABASE_URL (fetch 만)

왜 원본인가: 정보공개센터가 같은 공보를 표로 정리해 두었지만(github.com/opengirok/
congress_asset_disclosure) CC BY-NC-ND 라 가공해서 싣는 것이 허락되지 않는다.
국회공보는 국회사무처가 저작재산권 전부를 가진 공공저작물이라 자유이용이 된다.
그리고 PDF 가 이미지가 아니라 글자라 표를 다시 짤 필요 없이 줄 단위로 읽힌다.

공개 API 가 아니라 국회 홈페이지 화면이 쓰는 내부 엔드포인트다. 화면이 바뀌면 깨지므로
응답 형태가 예상과 다르면 조용히 넘기지 않고 멈춘다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import os
import re
import sys
import time
import unicodedata

import httpx

ORIGIN = "https://www.assembly.go.kr"
LIST_URL = f"{ORIGIN}/portal/cnts/cntsNamgzn/gongbo.do"
VIEW_URL = f"{ORIGIN}/portal/cnts/cntsCont/dataA.do"
META_URL = f"{ORIGIN}/portal/cnts/cntsNamgzn/mgznList.json"
BASE_Q = {"cntsDivCd": "NAMGZN", "pdfClsCd": "CPR", "menuNo": "601019"}

# 제21대 신규등록(2020-08) 부터. 그 앞은 이 사이트가 다루는 의원이 거의 없다.
FIRST_PDF_ID = 378621

# 공보에는 국회의원 말고 수석전문위원·정책연구위원 같은 1급 이상 공무원도 실린다.
MP_POSITIONS = ("국회의원", "국회의장", "국회부의장")

# 동명이인은 성명 뒤 괄호에 지역구나 한자가 붙는다: '김병욱(경기 성남시분당구을)' '이수진(李壽珍)'
HEAD = re.compile(r"소속\s+국회\s+직위\s+(.+?)\s+성명\s+(\S+?)(?:\((.+?)\))?\s*$", re.M)
TOTAL = re.compile(r"^총\s*계\s+(.+)$", re.M)
SUBTOTAL = re.compile(r"^▶\s*(.+?)\(소계\)\s+(.+)$", re.M)
REFUSED = re.compile(r"^(\S+)\s+고지거부", re.M)
# 신규등록 호는 '1. 제22대 국회의원(최초)' '2. …(재등록)' 으로 절이 갈린다.
SECTION = re.compile(r"^\d\.\s*제\d+대\s*국회의원\((최초|재등록)\)", re.M)
NUM = re.compile(r"-?\d[\d,]*")


def client() -> httpx.Client:
    return httpx.Client(
        timeout=300,
        follow_redirects=True,
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"},
    )


def list_issues(c: httpx.Client) -> list[tuple[int, str]]:
    """제목에 '재산' 이 든 공보 호. 최신부터 온다."""
    out: list[tuple[int, str]] = []
    page = 1
    while True:
        r = c.get(LIST_URL, params={**BASE_Q, "pdfSj": "재산", "pageIndex": page})
        r.raise_for_status()
        rows = re.findall(r"goView\('?(\d+)'?\)[^>]*>\s*([^<]+?)\s*<", r.text)
        if not rows and page == 1:
            raise RuntimeError("공보 목록 형태가 바뀌었습니다 (goView 없음)")
        fresh = [(int(i), n) for i, n in rows if int(i) >= FIRST_PDF_ID]
        out.extend(fresh)
        # 최신순이라 기준보다 오래된 호가 나오면 더 볼 필요가 없다.
        if len(fresh) < len(rows) or not rows:
            break
        page += 1
    return out


def issue_meta(c: httpx.Client, pdf_id: int) -> dict:
    """제목·공고일·다운로드 경로. 상세 화면의 CSRF 토큰과 쿠키가 있어야 답한다."""
    r = c.get(VIEW_URL, params={**BASE_Q, "pageIndex": 1, "pdfId": pdf_id})
    r.raise_for_status()
    m = re.search(r'name="_csrf" content="([^"]+)"', r.text)
    if not m:
        raise RuntimeError("상세 화면에 CSRF 토큰이 없습니다")
    r = c.post(META_URL, data={**BASE_Q, "pdfId": pdf_id, "_csrf": m.group(1)},
               headers={"X-Requested-With": "XMLHttpRequest"})
    r.raise_for_status()
    g = (r.json() or {}).get("mgzine") or {}
    if not g.get("pdfDownUrl") or not g.get("notiDt"):
        raise RuntimeError(f"공보 메타 형태가 바뀌었습니다: {list(g)[:8]}")
    return {
        "pdf_id": pdf_id,
        "title": g.get("pdfSj"),
        "notice_date": g["notiDt"],
        "down": ORIGIN + g["pdfDownUrl"],
        "link": ORIGIN + (g.get("linkUrl") or ""),
    }


def download(c: httpx.Client, url: str) -> bytes:
    r = c.get(url)
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise RuntimeError(f"PDF 가 아닙니다 ({len(r.content)}바이트)")
    return r.content


def pdf_pages(pdf: bytes) -> list[str]:
    import pdfplumber  # 무거워서 필요할 때만

    with pdfplumber.open(io.BytesIO(pdf)) as doc:
        return [(p.extract_text() or "").replace("\x00", "") for p in doc.pages]


def nums(s: str) -> list[int]:
    return [int(x.replace(",", "")) for x in NUM.findall(s)]


def age_at(date: dt.date) -> int:
    """그 날짜의 국회 대수. 제20대 임기가 2016-05-30 에 시작해 4년마다 바뀐다."""
    y = date.year - 2016 - (1 if (date.month, date.day) < (5, 30) else 0)
    return 20 + y // 4


def parse(pages: list[str], notice_date: str, regular: bool) -> list[dict]:
    """한 호의 PDF 쪽 글자들 → 의원별 한 행.

    한 사람 구획은 '소속 국회 직위 … 성명 …' 머리글에서 시작해 다음 머리글 앞에서
    끝나고, 끝에 '총 계' 줄이 하나 있다. 정기공개는 총계가 종전·증가·감소·현재 넷,
    신규등록은 현재 하나다. 실측으로 8개 호 모두 머리글 수와 총계 수가 같았다.
    """
    text = ""
    starts: list[int] = []  # 쪽마다 text 안에서 시작 위치
    for p in pages:
        starts.append(len(text))
        text += p + "\n"

    def page_of(pos: int) -> int:
        n = 0
        for i, s in enumerate(starts):
            if s <= pos:
                n = i
        return n + 1

    date = dt.date.fromisoformat(notice_date)
    age = age_at(date)
    sections = [(m.start(), m.group(1)) for m in SECTION.finditer(text)]
    heads = list(HEAD.finditer(text))
    out = []
    for i, h in enumerate(heads):
        position, name, hint = h.group(1).strip(), h.group(2).strip(), h.group(3)
        if not any(p in position for p in MP_POSITIONS):
            continue
        block = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        tot = TOTAL.findall(block)
        if not tot:
            raise RuntimeError(f"{name}: 총계 줄이 없습니다 ({notice_date})")
        # 재등록 의원은 같은 줄 뒤에 '증감액: -12,758천원' 이 붙어 온다. 앞의 숫자만 읽는다.
        t = nums(re.match(r"[-\d,\s]*", tot[-1]).group(0))
        retired = position.startswith("(전)")
        if regular:
            kind = "퇴직" if retired else "정기"
        else:
            kind = "퇴직" if retired else next(
                (k for s, k in reversed(sections) if s < h.start()), "최초")
        if len(t) == 4:
            prev, inc, dec, now = t
        elif len(t) == 1:
            prev = inc = dec = None
            now = t[0]
        else:
            raise RuntimeError(f"{name}: 총계 숫자가 {len(t)}개입니다: {tot[-1]}")
        breakdown = {}
        for cat, rest in SUBTOTAL.findall(block):
            v = nums(rest)
            if v:  # 고지거부 소계는 '- - - -' 라 숫자가 없다
                breakdown[re.sub(r"\s+", " ", cat).strip()] = v[-1]
        out.append({
            "seq": len(out) + 1,
            "name": name,
            "hint": hint,
            "position": position,
            "kind": kind,
            # 퇴직의원은 공고일이 이미 다음 대라서 한 대 앞이다.
            "age": age - 1 if retired and not regular else age,
            "page": page_of(h.start()),
            "total_prev_k": prev, "total_inc_k": inc, "total_dec_k": dec,
            "total_now_k": now,
            "breakdown": breakdown,
            "refused": sorted(set(REFUSED.findall(block)) - {"▶"}),
        })
    return out


def fetch_issue(c: httpx.Client, pdf_id: int) -> tuple[dict, list[dict]]:
    meta = issue_meta(c, pdf_id)
    pages = pdf_pages(download(c, meta["down"]))
    rows = parse(pages, meta["notice_date"], regular="정기" in (meta["title"] or ""))
    print(f"  {meta['title']}: {len(pages)}쪽, 의원 {len(rows)}명", file=sys.stderr)
    return meta, rows


def match(members: list[tuple], name: str, age: int, hint: str | None = None,
          notice_date: str | None = None, kind: str | None = None) -> str | None:
    """이름 + 그 대수에 재직했는가. 둘 이상이면 차례로 좁힌다.

    1. 공보가 이름 뒤에 붙인 괄호(지역구·한자)
    2. '최초' 등록이면 그 대가 첫 임기인 사람만 — 2020-08 공보의 김병욱은 괄호가 없는데
       21대 김병욱 둘 중 한 사람은 20대부터라 최초 등록일 수 없다.
    3. 공고일 뒤에 처음 당선된 사람은 뺀다 — 22대 박지원 둘 중 한 사람은 2026-06
       재보궐 당선이라 2026-03 공보에 없다. 다만 선거 이력이 빠진 사람(21대 비례
       이수진은 첫 당선이 2024 로 잡힌다)도 걸러지므로, 이 단계는 **하나가 남을 때만**
       쓰고 결과는 link() 의 중복 검사를 거친다.

    그래도 하나가 아니면 고르지 않는다 — 틀린 사람에게 붙느니 비운다.
    members 는 (code, name, terms, district, name_hanja, first_elected 'YYYYMMDD'|None).
    """
    hits = [m for m in members if m[1] == name and f"제{age}대" in (m[2] or "")]
    if len(hits) > 1 and hint:
        # '경기 성남시분당구을' 은 끝 토막만 member.district 와 겹친다. '비례대표' 도 같다.
        key = hint.split()[-1]
        # member.name_hanja 는 호환용 한자(李=U+F9E1)로 들어 있어 NFC 로 펴서 비교한다.
        nfc = lambda v: unicodedata.normalize("NFC", v or "")
        hits = [m for m in hits if nfc(hint) == nfc(m[4]) or key in (m[3] or "")]
    if len(hits) > 1 and kind == "최초":
        first = [m for m in hits
                 if not any(f"제{n}대" in (m[2] or "") for n in range(1, age))]
        hits = first or hits
    if len(hits) > 1 and notice_date:
        day = notice_date.replace("-", "")
        later = [m for m in hits if not m[5] or m[5] <= day]
        hits = later if len(later) == 1 else hits
    return hits[0][0] if len(hits) == 1 else None


def split_name(name: str) -> tuple[str, str | None]:
    """'김병욱(경기 성남시분당구을)' → ('김병욱', '경기 성남시분당구을')."""
    m = re.match(r"^(.+?)\((.+)\)$", name)
    return (m.group(1), m.group(2)) if m else (name, None)


def link(rows: list[dict], members: list[tuple]) -> dict[tuple[int, int], str | None]:
    """모든 신고 줄 → 의원 코드. rows 는 pdf_id·seq·name·age·kind·notice_date·
    total_prev_k·total_now_k 를 가진 dict.

    1. 줄마다 match().
    2. 같은 호에서 한 사람에게 두 줄이 붙으면 둘 다 비운다. 실제로 2021 공보의 괄호 없는
       이수진 둘이 한 사람에게 붙었다.
    3. 빈 줄은 금액으로 잇는다. 같은 사람의 연속 신고는 앞 호의 현재가액이 뒤 호의
       종전가액과 같다(실측 1,745쌍 중 1,732쌍, 나머지는 장관 재임 등으로 한 해를 건너뛴
       경우). 같은 이름의 확정된 줄 가운데 앞뒤로 딱 한 사람만 이어지면 붙인다.
       붙은 줄이 다시 단서가 되므로 더 붙지 않을 때까지 되풀이한다.
    """
    code: dict[tuple[int, int], str | None] = {}
    for r in rows:
        base, hint = split_name(r["name"])
        code[(r["pdf_id"], r["seq"])] = match(
            members, base, r["age"], hint, str(r["notice_date"]), r["kind"])

    def dedupe() -> None:
        seen: dict[tuple[int, str], list[tuple[int, int]]] = {}
        for k, c in code.items():
            if c:
                seen.setdefault((k[0], c), []).append(k)
        for ks in seen.values():
            if len(ks) > 1:
                for k in ks:
                    code[k] = None

    dedupe()
    by_key = {(r["pdf_id"], r["seq"]): r for r in rows}
    changed = True
    while changed:
        changed = False
        for k, r in by_key.items():
            if code[k]:
                continue
            base = split_name(r["name"])[0]
            used = {c for kk, c in code.items() if kk[0] == k[0] and c}
            cands = set()
            for kk, o in by_key.items():
                c = code[kk]
                if not c or c in used or split_name(o["name"])[0] != base:
                    continue
                before = o["notice_date"] < r["notice_date"]
                if before and r["total_prev_k"] is not None and o["total_now_k"] == r["total_prev_k"]:
                    cands.add(c)
                if not before and o["total_prev_k"] is not None and o["total_prev_k"] == r["total_now_k"]:
                    cands.add(c)
            if len(cands) == 1:
                code[k] = cands.pop()
                changed = True
    dedupe()
    return code


COLS = ["pdf_id", "seq", "member_code", "name", "position", "kind", "age", "notice_date",
        "issue", "page", "source_url", "total_prev_k", "total_inc_k", "total_dec_k",
        "total_now_k", "breakdown", "refused", "peer"]


def to_rows(meta: dict, rows: list[dict]) -> list[tuple]:
    """의원 코드는 비워 넣는다. 다른 호의 금액이 단서가 되므로 relink 가 전체를 보고 붙인다."""
    return [(
        meta["pdf_id"], r["seq"], None,
        f"{r['name']}({r['hint']})" if r["hint"] else r["name"], r["position"], r["kind"], r["age"],
        meta["notice_date"], meta["title"], r["page"], meta["link"],
        r["total_prev_k"], r["total_inc_k"], r["total_dec_k"], r["total_now_k"],
        json.dumps(r["breakdown"], ensure_ascii=False), r["refused"],
        str(meta["pdf_id"]),  # 비교 집단 = 같은 호에 실린 의원
    ) for r in rows]


def run_relink(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "select code, name, terms, district, name_hanja,"
            " (select min(election_id) from candidacy c where c.member_code = m.code"
            "   and c.elected and c.sg_typecode in ('2', '7')) from member m")
        members = cur.fetchall()
        cur.execute("select pdf_id, seq, name, age, kind, notice_date, total_prev_k, total_now_k"
                    " from asset_report where source = '국회공보'")
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    code = link(rows, members)
    with conn.cursor() as cur:
        cur.executemany("update asset_report set member_code = %s where pdf_id = %s and seq = %s",
                        [(c, k[0], k[1]) for k, c in code.items()])
    conn.commit()
    miss = [f"{r['name']}(제{r['age']}대, {r['notice_date']})"
            for r in rows if not code[(r["pdf_id"], r["seq"])]]
    print(f"[asset] 의원 연결 {len(rows) - len(miss)}/{len(rows)}", file=sys.stderr)
    if miss:
        print(f"  ! 못 붙인 줄 {len(miss)}: {', '.join(miss[:30])}", file=sys.stderr)


def run_fetch(conn, redo: bool) -> None:
    from ingest import upsert

    with conn.cursor() as cur:
        cur.execute("select distinct pdf_id from asset_report where source = '국회공보'")
        done = {r[0] for r in cur.fetchall()}

    with client() as c:
        issues = list_issues(c)
        todo = [i for i, _ in issues if redo or i not in done]
        print(f"[asset] 공보 {len(issues)}호, 받을 것 {len(todo)}호", file=sys.stderr)
        for pdf_id in todo:
            meta, rows = fetch_issue(c, pdf_id)
            with conn.cursor() as cur:
                cur.execute("delete from asset_report where pdf_id = %s", (pdf_id,))
                upsert(cur, "asset_report", COLS, to_rows(meta, rows), "pdf_id,seq")
            conn.commit()
            time.sleep(1)  # 공개 API 가 아니므로 천천히
    run_relink(conn)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["list", "fetch", "relink", "dump"])
    p.add_argument("--redo", action="store_true")
    p.add_argument("--out", default="asset.json")
    a = p.parse_args()

    if a.step == "list":
        with client() as c:
            for i, n in list_issues(c):
                print(i, n)
        return
    if a.step == "dump":
        with client() as c:
            dump = [dict(meta=m, rows=r) for m, r in
                    (fetch_issue(c, i) for i, _ in list_issues(c))]
        with open(a.out, "w") as f:
            json.dump(dump, f, ensure_ascii=False)
        print(f"[asset] {a.out} 저장", file=sys.stderr)
        return

    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        if a.step == "relink":
            run_relink(conn)
        else:
            run_fetch(conn, a.redo)


if __name__ == "__main__":
    main()

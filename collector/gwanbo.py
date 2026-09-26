#!/usr/bin/env python3
"""단체장·교육감 재산공개 수집기 — 대한민국 전자관보의 정부공직자윤리위원회 공고.

공직자윤리법 제10조에 따라 정부공직자윤리위원회가 시도지사·구시군의장·교육감의 재산을
관보에 싣는다. 해마다 3월 말 정기변동(시도별 절과 '시도교육청' 절), 달마다 수시(신규 등록·
퇴직). 국회공보와 표 모양이 같아 asset.py 의 읽기 규칙을 그대로 쓰고 asset_report 에 넣는다.

사용:
    python gwanbo.py list --year 2026     # 대상 절 목록만
    python gwanbo.py fetch                # 2022년부터, 이미 받은 절은 건너뜀
    python gwanbo.py fetch --since 2025 --redo
    python gwanbo.py relink               # 사람 연결만 다시

환경변수: DATABASE_URL (fetch·relink)

한 절에 부지사·실국장·산하기관장까지 실려 있다. 선출직 단체장·교육감만 골라 싣는다.
비교 집단(peer)은 '그해 정기공개의 같은 직위 전원' 이다 — 관보는 시도마다 절이 따로라
국회공보처럼 '같은 호' 로 묶으면 경기도 시장끼리만 비교된다.

공개 API 가 아니라 전자관보 화면이 쓰는 검색·내려받기 엔드포인트다. 내려받기는 뷰어의
'다운로드' 단추와 같은 주소(ofcttCntntDownload.do)다. 응답이 PDF 가 아니면 멈춘다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time

import httpx

from asset import REFUSED, SUBTOTAL, TOTAL, nums

ORIGIN = "https://gwanbo.go.kr"
SEARCH_URL = f"{ORIGIN}/SearchRestApi.jsp"
DOWN_URL = f"{ORIGIN}/user/common/ofcttCntntDownload.do"
SUBJECT_Q = ("(정부공직자 AND 재산공개) OR (정부공직자 AND 재산변동) OR (정부공직자 AND 재산등록)")
FIRST_YEAR = 2022  # 2022-06 지방선거 당선자의 첫 신고부터. 그 앞은 필요하면 --since 로

HEAD = re.compile(r"^소속\s+(.+?)\s+직위\s+(.+?)\s+성명\s+(\S+)\s*$", re.M)
KIND_SECTION = re.compile(r"^○\s*(\S+)", re.M)
# 선출직만. '행정부시장'·'부지사' 같은 것은 전부 일치가 아니라 걸리지 않는다.
ELECTED = re.compile(r"^(\(전\))?(시장|도지사|군수|구청장|교육감)$")
SIDO = {  # 시도 이름 → 짧은 이름. 개칭(강원도→강원특별자치도)을 한 이름으로 묶는다.
    "서울": "서울", "부산": "부산", "대구": "대구", "인천": "인천", "광주": "광주", "대전": "대전",
    "울산": "울산", "세종": "세종", "경기": "경기", "강원": "강원", "충청북": "충북", "충북": "충북",
    "충청남": "충남", "충남": "충남", "전라북": "전북", "전북": "전북", "전라남": "전남", "전남": "전남",
    "경상북": "경북", "경북": "경북", "경상남": "경남", "경남": "경남", "제주": "제주",
}
KIND = {"신규": "최초", "재등록": "재등록", "퇴직": "퇴직"}
# 시군구 개칭. 선거 기록은 당시 이름으로 남는다 — 인천 남구는 2018-07 미추홀구가 됐다.
WIW_OLD = {("인천", "미추홀구"): "남구"}
OFFICE = {"3": "시도지사", "4": "구시군의장", "11": "교육감"}


def sido(v: str | None) -> str | None:
    v = (v or "").replace("교육청", "")
    return next((s for k, s in SIDO.items() if v.startswith(k)), None)


def client() -> httpx.Client:
    return httpx.Client(timeout=120, headers={"User-Agent": "Mozilla/5.0 (nureongso)"},
                        follow_redirects=True)


def search(c: httpx.Client, year: int) -> list[dict]:
    """그해 정부공직자윤리위원회 재산 공고의 절 목록. 화면의 '테마별 검색' 과 같은 질의."""
    q = (f"unstored_field_subject:({SUBJECT_Q}) AND unstored_field_subject:({year})"
         " AND keyword_category_order:(@@ORDER_NUM)")
    out: list[dict] = []
    for page in range(1, 20):
        r = c.post(SEARCH_URL, data={"mode": "theme", "index": "gwanbo", "query": q, "pQuery_tmp": "",
                                      "pageNo": page, "listSize": 100, "sort": ""})
        r.raise_for_status()
        rows: list[dict] = []

        def walk(o):
            if isinstance(o, dict):
                if "stored_field_subject" in o:
                    rows.append(o)
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(r.json())
        if not rows:
            break
        out += rows
    return out


def pick(rows: list[dict], year: int) -> list[dict]:
    """단체장·교육감이 실릴 절만. 정기는 시도 절과 교육청 절, 수시는 전부."""
    out = []
    for r in rows:
        s = re.sub(r"\s+", " ", r["stored_field_subject"]).strip()
        if str(year) != str(r.get("stored_field_year")):
            continue  # 제목에 연도가 들어 있을 뿐인 다른 해 공고
        m = re.search(r"정기재산변동\s*신고사항\s*공개,\s*(.+?)\)$", s)
        if m:
            part = m.group(1).strip()
            if not (sido(part) or "교육청" in part):
                continue
            kind = "정기"
        elif re.search(r"재산등록사항\s*공개|재산공개목록\(수시\)", s):
            kind = "수시"
        else:
            continue
        toc = re.search(r"tocId=([^&]+)", r["stored_field_url"]).group(1)
        out.append({
            "toc": toc,
            "pdf_id": int(re.sub(r"\D", "", toc)[:-3]),  # 'I000…1774331157223000' → 1774331157223
            "title": s,
            "kind": kind,
            "notice_date": f"{r['stored_field_year']}-{r['stored_field_month']}-{int(r['stored_field_day']):02d}",
            "ebook": r.get("keyword_ebook_no") or r.get("stored_ebook_no"),
            "link": ORIGIN + r["stored_field_url"],
        })
    return out


def download(c: httpx.Client, toc: str) -> bytes:
    r = c.post(DOWN_URL, data={"cntnt_seq_no": toc})
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise RuntimeError(f"PDF 가 아닙니다 ({len(r.content)}바이트): {toc}")
    return r.content


def pdf_pages(pdf: bytes) -> list[str]:
    """단체장이 실린 쪽만 pdfplumber 로 읽고 나머지는 빈 쪽으로 둔다.

    수시 공개 한 절이 500쪽을 넘고 단체장은 대개 없다. pdfplumber 로 전부 읽으면 절 하나에
    1분이 넘어 150개 절에 세 시간이 걸렸다. pypdfium2 는 15배 빠르지만 글자 순서가 달라
    '총 계' 줄 숫자를 흩뜨린다(실측: 이권재 총계가 '2' 로 읽힘). 그래서 pypdfium2 로 머리글만
    훑어 선출직이 있는 쪽을 찾고, 그 사람 구획(다음 머리글이 있는 쪽까지)만 pdfplumber 로 읽는다.
    쪽 번호가 원문과 같도록 읽지 않은 쪽은 비워 두되, '○ 신규' 같은 구획 줄은 남긴다 — 비웠더니
    39쪽 단체장의 구획 표시(1쪽)가 사라져 종류를 못 가렸다(실측).
    """
    import io

    import pdfplumber
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf)
    rough = [doc[i].get_textpage().get_text_range() for i in range(len(doc))]
    heads = [(i, bool(ELECTED.match(m.group(2).strip())))
             for i, t in enumerate(rough) for m in HEAD.finditer(t.replace("\r\n", "\n"))]
    want: set[int] = set()
    for k, (page, elected) in enumerate(heads):
        if elected:
            end = heads[k + 1][0] if k + 1 < len(heads) else len(rough) - 1
            want.update(range(page, end + 1))
    out = ["\n".join(ln.strip() for ln in t.replace("\r\n", "\n").split("\n")
                      if KIND_SECTION.match(ln.strip())) for t in rough]
    if want:
        with pdfplumber.open(io.BytesIO(pdf)) as d:
            for i in sorted(want):
                out[i] = (d.pages[i].extract_text() or "").replace("\x00", "")
    return out


def parse(pages: list[str], regular: bool) -> list[dict]:
    """절 PDF → 선출직 한 사람당 한 행. 구획 규칙은 asset.parse 와 같다 — 머리글에서 시작해
    다음 머리글 앞에서 끝나고 끝에 '총 계' 가 하나. 정기는 총계 숫자 넷, 신규는 하나."""
    text, starts = "", []
    for p in pages:
        starts.append(len(text))
        text += p + "\n"
    page_of = lambda pos: max(i for i, s in enumerate(starts) if s <= pos) + 1
    sections = [(m.start(), m.group(1)) for m in KIND_SECTION.finditer(text)]
    heads = list(HEAD.finditer(text))
    out = []
    for i, h in enumerate(heads):
        org, position, name = (g.strip() for g in h.groups())
        if not ELECTED.match(position):
            continue
        # '경기도 경기경제자유구역청' 직위 '청장' 은 위에서 걸렀다. 소속이 지자체·교육청
        # 이름 자체여야 한다(토막 둘 이하).
        if len(org.split()) > 2:
            continue
        block = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        tot = TOTAL.findall(block)
        if not tot:
            raise RuntimeError(f"{org} {name}: 총계 줄이 없습니다")
        t = nums(re.match(r"[-\d,\s]*", tot[-1]).group(0))
        retired = position.startswith("(전)")
        if regular:
            kind = "퇴직" if retired else "정기"
        else:
            sec = next((k for s, k in reversed(sections) if s < h.start()), "")
            # 2022-09 공고의 별권 둘은 구획 표시 없이 새 단체장 표로 바로 시작한다. 구획을
            # 모르면 총계 모양으로 가른다 — 숫자 하나면 첫 등록, 넷이면 변동 신고.
            kind = "퇴직" if retired else KIND.get(sec) or sec or (
                "최초" if len(t) == 1 else "수시")
        if len(t) == 4:
            prev, inc, dec, now = t
        elif len(t) == 1:
            prev = inc = dec = None
            now = t[0]
        else:
            raise RuntimeError(f"{org} {name}: 총계 숫자가 {len(t)}개입니다: {tot[-1]}")
        breakdown = {}
        for cat, rest in SUBTOTAL.findall(block):
            v = nums(rest)
            if v:
                breakdown[re.sub(r"\s+", " ", cat).strip()] = v[-1]
        out.append({
            "org": org, "position": position.removeprefix("(전)"), "name": name,
            "retired": retired, "kind": kind, "page": page_of(h.start()),
            "total_prev_k": prev, "total_inc_k": inc, "total_dec_k": dec, "total_now_k": now,
            "breakdown": breakdown, "refused": sorted(set(REFUSED.findall(block)) - {"▶"}),
        })
    return out


def sg_type(org: str, position: str) -> str:
    """직위 → 선관위 선거종류. '서울특별시' 의 '시장' 은 시도지사, '경기도 수원시' 의 '시장' 은
    구시군의장이다. 소속이 한 토막(시도)이면 시도지사다."""
    if position == "교육감":
        return "11"
    # 수시 공개에는 시도 없이 '김천시' 만 적힌 소속도 있다. 한 토막이어도 시도가 아니면 구시군.
    return "3" if len(org.split()) == 1 and sido(org) else "4"


def match(cands: list[tuple], org: str, position: str, name: str, notice_date: str) -> str | None:
    """이름 + 선거종류 + 지역 + 공고일 전에 당선. 둘 이상이면 비운다.
    cands 는 (member_code, name, sg_typecode, election_id, sd_name, wiw_name) — 당선 기록.
    구시군의장의 wiw_name 은 선거구 이름이라 '수원시팔달구' 처럼 구까지 붙어 온다.
    """
    t = sg_type(org, position)
    parts = org.split()
    sd = sido(parts[0])
    wiw = parts[-1] if t == "4" else None
    day = notice_date.replace("-", "")
    wiws = {wiw, WIW_OLD.get((sd, wiw))} - {None}

    def hits(check_sd: bool) -> set[str]:
        return {c[0] for c in cands
                if c[1] == name and c[2] == t and c[3] <= day
                and (not check_sd or sido(c[4]) == sd)
                and (t != "4" or any((c[5] or "").startswith(w) for w in wiws))}

    # 시도가 없거나(수시의 '김천시'), 시군구가 시도를 옮기면(군위군: 2023-07 경북→대구)
    # 시도로는 안 맞는다. 그때만 시도를 빼고 이름·시군구로 다시 본다.
    got = hits(sd is not None) or (hits(False) if t == "4" else set())
    return got.pop() if len(got) == 1 else None


def peer_of(kind: str, notice_date: str, org: str, position: str) -> str | None:
    """정기공개만 비교 집단을 둔다. 수시는 그달 신규·퇴직 몇 명이라 비교가 안 된다."""
    if kind != "정기":
        return None
    return f"관보:{notice_date[:4]}:정기:{OFFICE[sg_type(org, position)]}"


COLS = ["pdf_id", "seq", "member_code", "name", "position", "kind", "age", "notice_date",
        "issue", "page", "source_url", "total_prev_k", "total_inc_k", "total_dec_k",
        "total_now_k", "breakdown", "refused", "peer", "source"]


def to_rows(meta: dict, rows: list[dict]) -> list[tuple]:
    issue = f"관보 제{meta['ebook']}호 " + re.sub(r"^(정부공직자윤리위원회공고)\s*", r"\1 ", meta["title"])
    return [(
        meta["pdf_id"], i + 1, None, r["name"], f"{r['org']} {'(전)' if r['retired'] else ''}{r['position']}",
        r["kind"], None, meta["notice_date"], issue, r["page"], meta["link"],
        r["total_prev_k"], r["total_inc_k"], r["total_dec_k"], r["total_now_k"],
        json.dumps(r["breakdown"], ensure_ascii=False), r["refused"],
        peer_of(r["kind"], meta["notice_date"], r["org"], r["position"]), "관보",
    ) for i, r in enumerate(rows)]


def run_relink(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("select member_code, m.name, sg_typecode, election_id, sd_name, wiw_name"
                    " from candidacy c join member m on m.code = c.member_code"
                    " where c.elected and sg_typecode in ('3', '4', '11')")
        cands = cur.fetchall()
        cur.execute("select pdf_id, seq, name, position, notice_date from asset_report where source = '관보'")
        rows = cur.fetchall()
    out, miss = [], []
    for pdf_id, seq, name, position, notice_date in rows:
        org, _, pos = position.rpartition(" ")
        code = match(cands, org, pos.removeprefix("(전)"), name, str(notice_date))
        out.append((code, pdf_id, seq))
        if not code:
            miss.append(f"{name}({position}, {notice_date})")
    with conn.cursor() as cur:
        cur.executemany("update asset_report set member_code = %s where pdf_id = %s and seq = %s", out)
    conn.commit()
    print(f"[gwanbo] 사람 연결 {len(rows) - len(miss)}/{len(rows)}", file=sys.stderr)
    if miss:
        print(f"  ! 못 붙인 줄 {len(miss)}: {', '.join(miss[:30])}", file=sys.stderr)


def run_fetch(conn, since: int, redo: bool) -> None:
    from ingest import upsert

    with conn.cursor() as cur:
        cur.execute("select distinct pdf_id from asset_report where source = '관보'")
        done = {r[0] for r in cur.fetchall()}
        cur.execute("select pdf_id from gwanbo_seen")
        done |= {r[0] for r in cur.fetchall()}  # 받아 봤지만 단체장이 없던 절
    with client() as c:
        # 같은 절이 검색 결과에 두 번 올 수 있어 절 번호로 한 번만 남긴다.
        items = list({m["pdf_id"]: m for y in range(since, dt.date.today().year + 1)
                      for m in pick(search(c, y), y)}.values())
        todo = [m for m in items if redo or m["pdf_id"] not in done]
        print(f"[gwanbo] 절 {len(items)}개, 받을 것 {len(todo)}개", file=sys.stderr)
        for meta in todo:
            pages = pdf_pages(download(c, meta["toc"]))
            rows = parse(pages, regular=meta["kind"] == "정기")
            print(f"  {meta['notice_date']} {meta['title'][-40:]}: {len(pages)}쪽, 단체장·교육감 {len(rows)}명",
                  file=sys.stderr)
            with conn.cursor() as cur:
                cur.execute("delete from asset_report where pdf_id = %s", (meta["pdf_id"],))
                if rows:
                    upsert(cur, "asset_report", COLS, to_rows(meta, rows), "pdf_id,seq")
                cur.execute("insert into gwanbo_seen (pdf_id, title, rows) values (%s, %s, %s)"
                            " on conflict (pdf_id) do update set rows = excluded.rows, seen_at = now()",
                            (meta["pdf_id"], meta["title"], len(rows)))
            conn.commit()
            time.sleep(1)  # 공개 API 가 아니므로 천천히
    run_relink(conn)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["list", "fetch", "relink"])
    p.add_argument("--year", type=int, default=dt.date.today().year)
    p.add_argument("--since", type=int, default=FIRST_YEAR)
    p.add_argument("--redo", action="store_true")
    a = p.parse_args()

    if a.step == "list":
        with client() as c:
            for m in pick(search(c, a.year), a.year):
                print(m["notice_date"], m["kind"], m["pdf_id"], m["title"])
        return

    import psycopg

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        if a.step == "relink":
            run_relink(conn)
        else:
            run_fetch(conn, a.since, a.redo)


if __name__ == "__main__":
    main()

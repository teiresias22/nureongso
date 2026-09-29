#!/usr/bin/env python3
"""광역단체장 업무추진비 집행내역 수집기.

전국을 한 번에 주는 곳이 없다(2026-09-29 실측). 지방재정365 API 3종은 지자체별 예산 편성
**총액**만 주고, 서울 열린데이터광장 업무추진비 API 는 서비스가 끝났다. 건별 내역은 각
시도가 누리집에 달·분기마다 올리는 게시물뿐이라 곳마다 어댑터를 둔다.

항목은 행안부 규칙이 정해 둬서 거의 같다(일시·장소·목적·금액·인원·결제방법). 그래서
어댑터는 **표(머리줄 + 행)만** 돌려주고, 머리줄 이름을 공통 칸으로 옮기는 건 한 곳(norm)
에서 한다. 새 시도를 붙일 때는 게시판에서 표를 꺼내는 부분만 쓰면 된다.

받은 게시물(source_url)은 다시 받지 않는다. 같은 기간이 고쳐서 다시 올라오면(서울 2026년
8월이 두 번 올라와 있다) 그 기간 줄을 지우고 새 게시물로 채운다.

사용:
    python expense.py fetch                    # 전 시도, 기본 2026-07-01 이후 기간
    python expense.py fetch --org 서울특별시 --since 2024-01-01

환경변수: DATABASE_URL
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import io
import os
import re
import sys
import zipfile
from typing import Callable, Iterator

import httpx
import psycopg

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128 Safari/537.36"}
TERM_START = "2026-07-01"   # 민선 9기 취임. 그 전은 전임자의 돈이다.

# 한 게시물에서 꺼낸 표. period 는 'YYYY-MM' 이나 'YYYY-Qn'.
Table = tuple[str, str, list[str], list[list[str]]]   # (source_url, period, header, rows)


# --------------------------------------------------------------------------- 공통

def text(x: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x))).strip()


def html_tables(page: str) -> list[list[list[str]]]:
    """페이지의 <table> 들을 [행][칸] 글자로. 병합 칸은 신경 쓰지 않는다 — 내역 표는 평평하다."""
    out = []
    for tb in re.findall(r"<table.*?</table>", page, re.S | re.I):
        rows = [[text(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S | re.I)]
                for tr in re.findall(r"<tr.*?</tr>", tb, re.S | re.I)]
        out.append([r for r in rows if any(r)])
    return out


def xlsx_sheets(data: bytes) -> list[tuple[str, list[list[str]]]]:
    """xlsx 를 시트별 (이름, [행][칸] 글자) 로. 표준 라이브러리만 쓴다(zip + XML).
    제주처럼 사람마다 시트가 따로면('도지사(공개)') 이름으로 고른다.

    칸 주소(B7)를 보고 자리를 맞춘다 — 빈 칸은 XML 에 아예 없어서 순서대로 채우면 밀린다.
    """
    z = zipfile.ZipFile(io.BytesIO(data))
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8")
        shared = [html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)))
                  for si in re.findall(r"<si>(.*?)</si>", x, re.S)]

    def col(ref: str) -> int:
        n = 0
        for ch in re.match(r"[A-Z]+", ref).group(0):
            n = n * 26 + ord(ch) - 64
        return n - 1

    # 시트 이름은 workbook.xml 에, 파일 경로는 rels 에 있다.
    wb = z.read("xl/workbook.xml").decode("utf-8")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    target = {rid: t for rid, t in re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rels)}
    target |= {rid: t for t, rid in re.findall(r'<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"', rels)}
    order = [(html.unescape(nm), "xl/" + target[rid].lstrip("/").removeprefix("xl/"))
             for nm, rid in re.findall(r'<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"', wb)]
    sheets = []
    for sheet_name, n in order:
        if n not in z.namelist():
            continue
        x = z.read(n).decode("utf-8")
        rows = []
        for r in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
            cells: dict[int, str] = {}
            for attrs, body in re.findall(r"<c([^>]*?)(?:/>|>(.*?)</c>)", r, re.S):
                ref = re.search(r'r="([A-Z]+)\d+"', attrs)
                if not ref:
                    continue
                v = re.search(r"<v>(.*?)</v>", body or "", re.S)
                if 't="s"' in attrs and v:
                    val = shared[int(v.group(1))]
                elif 't="inlineStr"' in attrs:
                    val = html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S)))
                else:
                    val = html.unescape(v.group(1)) if v else ""
                cells[col(ref.group(1))] = val.strip()
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        sheets.append((sheet_name, rows))
    return sheets


def xlsx_or_skip(data: bytes, url: str) -> list[tuple[str, list[list[str]]]]:
    """xlsx 가 아니면 건너뛴다. 부산 2026년 1분기 시장 파일은 Fasoo DRM 으로 잠겨 올라왔다
    (첫 바이트가 'DRMONE'). 잠금을 풀지 않는다 — 못 읽은 기간으로 남긴다."""
    if not data.startswith(b"PK"):
        why = "DRM 잠김" if b"DRM" in data[:64] else "xlsx 아님"
        print(f"    건너뜀({why}): {url}", file=sys.stderr)
        return []
    return xlsx_sheets(data)


def pdf_rows(data: bytes, keep: Callable[[str], bool] | None = None) -> list[list[str]]:
    """PDF 의 표를 쪽을 이어 한 줄 목록으로. 머리줄이 첫 쪽에만 있는 곳(인천·경남)이 있어
    쪽마다 따로 보면 뒤쪽이 머리 없는 표가 된다. keep 은 쪽 글자를 보고 그 쪽을 쓸지 정한다
    (충북은 한 파일에 도지사·부지사·국장이 쪽별로 들어 있다)."""
    import pdfplumber
    out: list[list[str]] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            if keep and not keep(page.extract_text() or ""):
                continue
            for t in page.extract_tables():
                out += [[(c or "").strip() for c in r] for r in t]
    return out


def split(rows: list[list[str]]) -> tuple[list[str], list[list[str]]] | None:
    h = find_header(rows)
    return (rows[h], rows[h + 1:]) if h is not None else None


def get(c: httpx.Client, url: str, **kw) -> httpx.Response:
    r = c.get(url, **kw)
    r.raise_for_status()
    return r


# 머리줄 이름 → 공통 칸. 공백·괄호를 뺀 이름으로 맞춘다.
FIELDS = {
    "used_at": ("사용일시", "일시", "집행일시", "사용일자", "집행일자", "승인일", "일자", "사용일",
                "카드사용일"),
    "time": ("사용시간", "승인시각", "시간", "집행시간", "집행시각"),
    "place": ("사용장소", "장소", "가맹점명", "집행장소", "업소명", "사용처", "집행처"),
    "purpose": ("사용목적", "집행목적", "집행내역", "목적", "집행내용", "건명", "내역", "사용내용",
                "결제내용", "내용", "적요"),
    "amount": ("사용금액", "금액", "승인금액", "집행금액", "지출액", "집행액", "지출금액"),
    "headcount": ("사용자및인원", "대상인원수", "인원", "대상인원", "인원/수량", "집행인원",
                  "집행대상", "참석인원"),
    "payment": ("결제방법", "집행방법", "사용방법", "결제방식", "카드/현금", "지출방법", "종류",
                "결재방법"),
    "kind": ("비목", "업무추진비구분", "예산통계목", "집행유형"),
    "user": ("사용자", "지출자"),
}


def key(h: str) -> str:
    return re.sub(r"\(.*?\)|\s", "", h or "")


def header_map(header: list[str]) -> dict[str, int]:
    m: dict[str, int] = {}
    for i, h in enumerate(header):
        k = key(h)
        for f, names in FIELDS.items():
            if f not in m and k in names:
                m[f] = i
    return m


def find_header(rows: list[list[str]]) -> int | None:
    """맨 위 몇 줄은 제목·단위일 수 있다. 금액과 장소가 둘 다 있는 첫 줄이 머리줄이다."""
    for i, r in enumerate(rows[:10]):
        m = header_map(r)
        if "amount" in m and ("place" in m or "purpose" in m):
            return i
    return None


def when(v: str, t: str = "") -> dt.datetime | None:
    """날짜 칸과 (따로 있으면) 시간 칸을 합친다. 엑셀 일련번호(46237)·하루 비율(0.568)·
    '2026-08-03 12:52'·'2026. 8. 3.' 이 다 온다. 시간을 모르면 0시로 둔다."""
    v, t = (v or "").strip(), (t or "").strip()
    serial = re.fullmatch(r"\d{5}(\.\d+)?", v)
    frac = re.fullmatch(r"0?\.\d+", t)
    hm = re.search(r"(\d{1,2}):(\d{2})", t)
    if serial:
        at = dt.datetime(1899, 12, 30) + dt.timedelta(days=float(v))
    else:
        m = re.search(r"(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?", v)
        if not m:
            return None
        y, mo, d, hh, mm = m.groups()
        at = dt.datetime(int(y), int(mo), int(d), int(hh or 0), int(mm or 0))
    if frac:
        at = at.replace(hour=0, minute=0) + dt.timedelta(days=float(t))
    elif hm and at.hour == 0 and at.minute == 0:
        at = at.replace(hour=int(hm.group(1)) % 24, minute=int(hm.group(2)))
    return at.replace(second=0, microsecond=0)


def won(v: str) -> int | None:
    # 곡성 PDF 처럼 '1 13,000' 으로 쪼개져 나오는 곳이 있어 숫자 밖은 다 버린다.
    d = re.sub(r"[^\d]", "", v or "")
    return int(d) if d else None


def people(v: str) -> int | None:
    """'8' → 8, '시장 외 13명' → 14, '직원 25명' → 25."""
    v = v or ""
    m = re.search(r"외\s*(\d+)\s*명", v)
    if m:
        return int(m.group(1)) + 1
    m = re.search(r"(\d+)", v)
    return int(m.group(1)) if m else None


def norm(org: str, table: Table, head: str | None) -> list[tuple]:
    """표 하나를 저장할 행으로. head 를 주면 '사용자' 칸이 그 직함인 줄만 남긴다."""
    url, period, header, rows = table
    m = header_map(header)
    out = []
    for r in rows:
        g = lambda f: r[m[f]] if f in m and m[f] < len(r) else ""
        at = when(g("used_at"), g("time"))
        amt = won(g("amount"))
        if not at or not amt:                        # 소계·합계·빈 줄
            continue
        # startswith 로 본다 — '시장' in '부시장' 도 참이다.
        if head and "user" in m and not g("user").strip().startswith(head):
            continue
        out.append((url, org, period, at, g("place") or None, g("purpose") or None,
                    amt, people(g("headcount")), g("payment") or None, g("kind") or None))
    return out


# --------------------------------------------------------------------------- 어댑터
# 각 어댑터는 since 이후 기간의 (source_url, period, header, rows) 를 낸다.

def seoul(c: httpx.Client, since: str) -> Iterator[Table]:
    # 정보소통광장. 시장 게시물은 제목이 '… 서울특별시장 업무추진비 - …' 이다.
    # 같은 달이 두 번 올라온 적이 있어(2026년 8월) 달마다 번호가 가장 큰 것만 쓴다.
    base = "https://opengov.seoul.go.kr"
    page = c.get(base + "/expense/list", params={
        "searchKeyword": "서울특별시장 업무추진비", "ym[year]": "all", "ym[month]": "all",
        "items_per_page": "50"}).text
    latest: dict[str, int] = {}
    for pid, title in re.findall(r'href="/expense/(\d+)"[^>]*>(.*?)</a>', page, re.S):
        t = text(title)
        m = re.match(r"(\d{4})년 (\d{1,2})월 서울시본청 서울특별시장 업무추진비", t)
        if not m:
            continue
        period = f"{m.group(1)}-{int(m.group(2)):02d}"
        if period >= since[:7]:
            latest[period] = max(latest.get(period, 0), int(pid))
    for period, pid in sorted(latest.items()):
        url = f"{base}/expense/{pid}"
        for rows in html_tables(c.get(url).text):
            h = find_header(rows)
            if h is not None:
                yield url, period, rows[h], rows[h + 1:]


def busan(c: httpx.Client, since: str) -> Iterator[Table]:
    # 분기마다 '…(시장, 부시장)' 게시물 하나에 시장·부시장 xlsx 가 따로 붙는다.
    base = "https://www.busan.go.kr"
    page = c.get(base + "/ghopen12/list", params={"schBizNo": "46"}).text
    for idx, title in re.findall(r'schIndx=(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S):
        m = re.match(r"(\d{4})년 (\d)분기 업무추진비 집행내역\(시장", text(title))
        if not m:
            continue
        period = f"{m.group(1)}-Q{m.group(2)}"
        if f"{m.group(1)}-{int(m.group(2)) * 3:02d}" < since[:7]:   # 분기 마지막 달로 가른다
            continue
        view = f"{base}/ghopen12/view?schCommand=Expense&schIndx={idx}&schBizNo=46"
        vp = c.get(view).text
        for no, name in re.findall(r'getFile\?srvcId=OPENGOV&(?:amp;)?upperNo=\d+&(?:amp;)?fileTy=ATTACH&(?:amp;)?fileNo=(\d+)"[^>]*>([^<]*)', vp):
            if "부시장" in name or "시장" not in name:
                continue
            url = f"{base}/comm/getFile?srvcId=OPENGOV&upperNo={idx}&fileTy=ATTACH&fileNo={no}"
            data = c.get(url, headers={"Referer": view}).content
            for _, rows in xlsx_or_skip(data, url):
                if t := split(rows):
                    yield url, period, *t


def ym(title: str) -> str | None:
    """'2026년 8월분 …' · '2026. 8월 …' → '2026-08'."""
    m = re.search(r"(\d{4})\s*[년.]\s*(\d{1,2})\s*월", title)
    return f"{m.group(1)}-{int(m.group(2)):02d}" if m else None


# ponytail: 어댑터는 목록 첫 쪽(최근 10~50건)만 본다. 임기 시작(2026-07) 뒤만 모으니 넉넉하다.
# 지난 임기를 거슬러 받으려면 쪽 넘김을 붙여야 한다.

def jeju(c: httpx.Client, since: str) -> Iterator[Table]:
    # 도지사·부지사가 한 xlsx 에 시트별로('도지사(공개)'). 시트 이름으로 고른다.
    base = "https://www.jeju.go.kr/open/open/iopenboard.htm"
    page = get(c, base, params={"category": "1003", "page": "1"}).text
    for seq, title in dict.fromkeys(re.findall(r'seq=(\d+)[^"]*"[^>]*>\s*([^<]+?)\s*<', page)):
        period = ym(title)
        if not period or period < since[:7] or "도지사" not in title:
            continue
        url = f"{base}?category=1003&act=download&seq={seq}&no=1"
        for name, rows in xlsx_or_skip(get(c, url).content, url):
            if name.startswith("도지사") and (t := split(rows)):
                yield url, period, *t


def gangwon(c: httpx.Client, since: str) -> Iterator[Table]:
    # 게시물마다 한 사람. 제목 끝이 '(도지사)' 인 것만. 권한대행 달은 '(도지사 권한대행 …)' 이라 빠진다.
    base = "https://state.gwd.go.kr/portal/administration/opendata/propulsionCost/governor"
    page = get(c, base, params={"pageIndex": "1"}).text
    for seq, title in re.findall(r"goPage\((\d+)\)[^>]*>\s*([^<]+?)\s*<", page):
        period = ym(title)
        if not period or period < since[:7] or not title.rstrip().endswith("(도지사)"):
            continue
        view = get(c, base, params={"articleSeq": seq}).text
        for fid in dict.fromkeys(re.findall(r"/egf/bp/common/front/(\d+)/download", view)):
            url = f"https://state.gwd.go.kr/egf/bp/common/front/{fid}/download"
            for _, rows in xlsx_or_skip(get(c, url).content, url):
                if t := split(rows):
                    yield url, period, *t


def gyeonggi(c: httpx.Client, since: str) -> Iterator[Table]:
    # 도지사 전용 게시판. 목록은 AJAX(POST) 로 오고 첨부 xlsx 주소가 목록에 바로 있다.
    # 기관·시책 두 시트이고 시트마다 시작 칸이 다르다(칸 주소로 맞추니 상관없다).
    j = c.post("https://www.gg.go.kr/ajax/board/getList.do", data={
        "bsIdx": "803", "bcIdx": "0", "menuId": "1768", "isManager": "false",
        "isCharge": "false", "offset": "0", "limit": "20"}).json()
    for it in j["items"]:
        period = ym(it["SUBJECT"])
        if not period or period < since[:7] or not it.get("IMAGE_URL"):
            continue
        url = "https://www.gg.go.kr" + it["IMAGE_URL"]
        for _, rows in xlsx_or_skip(get(c, url).content, url):
            if t := split(rows):
                yield url, period, *t


def yq(title: str) -> tuple[str, str] | None:
    """'2026년 2분기 …' → ('2026-Q2', '2026-06'). 뒤쪽은 그 분기 마지막 달(since 와 견준다)."""
    m = re.search(r"(\d{4})\s*년\s*(\d)\s*분기", title)
    return (f"{m.group(1)}-Q{m.group(2)}", f"{m.group(1)}-{int(m.group(2)) * 3:02d}") if m else None


def pdf_tables(c: httpx.Client, url: str, period: str, keep=None, **kw) -> Iterator[Table]:
    data = get(c, url, **kw).content
    if not data.startswith(b"%PDF"):
        print(f"    건너뜀(PDF 아님): {url}", file=sys.stderr)
        return
    if t := split(pdf_rows(data, keep)):
        yield url, period, *t


def incheon(c: httpx.Client, since: str) -> Iterator[Table]:
    # 시장 전용 게시판. 달마다 PDF 셋(기관운영 하나, 시책추진 둘)이 붙는다. 머리줄은 첫 쪽에만.
    base = "https://www.incheon.go.kr"
    page = get(c, base + "/open/OPEN010301", params={"curPage": "1"}).text
    for pid, title in re.findall(r'OPEN010301/(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S):
        title = text(title)
        period = ym(title)
        if not period or period < since[:7] or "시장 업무추진비" not in title:
            continue
        view = f"{base}/open/OPEN010301/{pid}"
        for no in dict.fromkeys(re.findall(rf"upperNo={pid}&(?:amp;)?fileTy=ATTACH&(?:amp;)?fileNo=(\d+)", get(c, view).text)):
            yield from pdf_tables(c, f"{base}/comm/getFile?srvcId=BBSTY1&upperNo={pid}&fileTy=ATTACH&fileNo={no}",
                                  period, headers={"Referer": view})


def daejeon(c: httpx.Client, since: str) -> Iterator[Table]:
    # '시장, 부시장' 게시판. 파일이 사람별로 붙는다('1.시장(…).pdf'). 시장 파일에도 시장 예산으로
    # 쓴 국장·실장 줄이 섞여 있어 '사용자' 칸으로 한 번 더 거른다.
    base = "https://www.daejeon.go.kr"
    page = get(c, base + "/drh/open/drhDataOpen/drhDataOpenBoardView.do",
               params={"boardSeq": "1186", "menuSeq": "4804"}).text
    for aid, title in re.findall(r"articleSeq[=,'\"\s(]+(\d+).{0,300}?(20\d\d년[^<]{0,40})", page, re.S):
        period = ym(title)
        if not period or period < since[:7]:
            continue
        view = get(c, base + "/drh/open/drhDataOpen/drhDataOpenBoardArticleView.do",
                   params={"menuSeq": "4804", "boardSeq": "1186", "articleSeq": aid}).text
        for path, name in dict.fromkeys(re.findall(r"fileDownLoad\('([^']+)',\s*'([^']+)'\)", view)):
            if "시장" not in name or "부시장" in name:
                continue
            url = str(httpx.URL(base + "/cmm/Download.do", params={"filePath": path, "fileName": name}))
            yield from pdf_tables(c, url, period)


def ulsan(c: httpx.Client, since: str) -> Iterator[Table]:
    # 쓴 날마다 게시물 하나, 내역은 HTML 표. **금액이 천원 단위**라 원 단위는 잃는다 — 1,000 을
    # 곱해 넣는다(39 → 39,000). 날짜는 표에 없고 주소(useDe)에만 있어 칸을 덧붙인다.
    base = "https://www.ulsan.go.kr/u/rep/transfer/ecnmy/list.ulsan"
    days: list[str] = []
    for n in range(1, 30):
        page = get(c, base, params={"se": "1", "mId": "001003002007000000", "curPage": str(n)}).text
        got = re.findall(r"f_detail\('(\d{4}-\d{2}-\d{2})',\s*'1'\)", page)
        days += [d for d in got if d >= since]
        if not got or min(got) < since:
            break
    for day in dict.fromkeys(days):
        url = f"{base}?mId=001003002007000000&useDe={day}&se=1"
        tables = html_tables(get(c, url).text)
        t = split(tables[0]) if tables else None
        if not t:
            continue
        header, rows = t
        m = header_map(header)
        rows = [[day] + [str((won(v) or 0) * 1000) if i == m.get("amount") else v for i, v in enumerate(r)]
                for r in rows]
        yield url, day[:7], ["사용일자"] + header, rows


def sejong(c: httpx.Client, since: str) -> Iterator[Table]:
    # '시장, 부시장' 게시물에 PDF 가 사람별로(…(시장).pdf). 숫자가 '6 50,000' 처럼 쪼개져 나오지만
    # won() 이 숫자 밖을 다 버려서 상관없다.
    base = "https://www.sejong.go.kr"
    page = get(c, base + "/bbs/R0091/list.do", params={"pageIndex": "1"}).text
    for nid, title in dict.fromkeys(re.findall(r'nttId=([A-Za-z0-9]+)[^"]*"[^>]*>(.*?)</a>', page, re.S)):
        title = text(title)
        period = ym(title)
        if not period or period < since[:7] or "시장" not in title or "부서별" in title:
            continue
        view = get(c, base + "/bbs/R0091/view.do", params={"nttId": nid}).text
        for fid, sn, name in re.findall(
                r"fn_egov_downFile\('([^']+)',\s*'(\d+)'\).*?([^<>|]+?\.pdf)", view, re.S):
            if "(시장)" in name:
                yield from pdf_tables(c, f"{base}/cmm/fms/FileDown.do?atchFileId={fid}&fileSn={sn}", period)


def chungbuk(c: httpx.Client, since: str) -> Iterator[Table]:
    # 여러 부서가 쓰는 게시판을 '도지사' 로 찾는다. PDF 한 파일에 도지사·부지사·국장이 쪽별로
    # 들어 있어 '[도지사]' 가 적힌 쪽만 쓴다.
    base = "https://www.chungbuk.go.kr/www"
    page = get(c, base + "/selectBbsNttList.do",
               params={"key": "211", "bbsNo": "2", "searchCnd": "SJ", "searchKrwd": "도지사"}).text
    for nno, title in re.findall(r'nttNo=(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S):
        title = text(title)
        period = ym(title)
        if not period or period < since[:7] or "도지사" not in title:
            continue
        view = get(c, base + "/selectBbsNttView.do", params={"key": "211", "bbsNo": "2", "nttNo": nno}).text
        for fno in dict.fromkeys(re.findall(r"downloadBbsFile\.do\?key=211&(?:amp;)?bbsNo=2&(?:amp;)?atchmnflNo=(\d+)", view)):
            yield from pdf_tables(c, f"{base}/downloadBbsFile.do?key=211&bbsNo=2&atchmnflNo={fno}", period,
                                  keep=lambda t: bool(re.search(r"\[\s*도\s*지\s*사\s*\]", t)))


def jeonbuk(c: httpx.Client, since: str) -> Iterator[Table]:
    # 도지사 분류(PERSON01) 게시판. 달마다 도지사만 든 PDF 하나. 다른 기관 글이 잘못 섞인 적이 있어
    # 제목도 본다.
    base = "https://jeonbuk.go.kr/board"
    q = {"boardId": "BBS_0000029", "menuCd": "DOM_000000103005000000"}
    page = get(c, base + "/list.jeonbuk", params={**q, "categoryCode1": "PERSON01"}).text
    for sid, title in re.findall(r'dataSid=(\d+)[^"]*"[^>]*>(.*?)</a>', page, re.S):
        title = text(title)
        period = ym(title)
        if not period or period < since[:7] or "도지사 업무추진비" not in title:
            continue
        view = get(c, base + "/view.jeonbuk", params={**q, "dataSid": sid}).text
        for fsid in dict.fromkeys(re.findall(r"download\.jeonbuk\?[^\"']*?fileSid=(\d+)", view)):
            yield from pdf_tables(c, f"{base}/download.jeonbuk?boardId=BBS_0000029&menuCd=DOM_000000103005000000"
                                     f"&dataSid={sid}&command=update&fileSid={fsid}", period)


def gyeongbuk(c: httpx.Client, since: str) -> Iterator[Table]:
    # 여러 부서 게시판에서 제목이 '도지사 업무추진비 공개(YYYY년 M월)' 로 시작하는 것.
    # '도지사' 로 찾으면 행정부지사·경제부지사 글도 걸려서 제목 앞머리로 가른다.
    base = "https://www.gb.go.kr"
    q = {"pageDtlOrdrNo": "2", "boardMngNo": "67"}
    page = get(c, base + "/page/10461/10173.do", params={
        **q, "importUrl": "/board/list.do", "searchCondition": "1", "searchKeyword": "도지사",
        "pageIndex": "1", "recordCountPerPage": "30"}).text
    for bno, title in dict.fromkeys(re.findall(r"(\d{6,}).{0,200}?(도지사 업무추진비 공개\([^)]*\))", page, re.S)):
        period = ym(title)
        if not period or period < since[:7]:
            continue
        view = get(c, base + "/page/10461/10173.do",
                   params={**q, "boardNo": bno, "importUrl": "/board/view.do"}).text
        for fid, fno in dict.fromkeys(re.findall(r'putFileHtml\(\s*"([^"]+)"\s*,\s*"(\d+)"', view)):
            yield from pdf_tables(c, f"{base}/file/readFile.do?fileId={fid}&fileNo={fno}", period)


def gyeongnam(c: httpx.Client, since: str) -> Iterator[Table]:
    # 분기마다 도지사·부지사·기관운영이 한 표에 섞인 PDF. '사용자' 칸이 '도지사' 인 줄만 쓴다.
    base = "https://www.gyeongnam.go.kr/board"
    q = {"boardId": "BBS_0000957", "menuCd": "DOM_000000138002012000"}
    page = get(c, base + "/list.gyeong", params={**q, "searchType": "DATA_TITLE", "keyword": "도지사"}).text
    for sid, title in dict.fromkeys(re.findall(r'dataSid=(\d+)[^"]*"[^>]*>([^<]*?도지사[^<]*)</a>', page, re.S)):
        q_ = yq(title)
        if not q_ or q_[1] < since[:7]:
            continue
        view = get(c, base + "/view.gyeong", params={**q, "dataSid": sid}).text
        for fsid in dict.fromkeys(re.findall(r"download\.gyeong\?[^\"']*?fileSid=(\d+)", view)):
            yield from pdf_tables(c, f"{base}/download.gyeong?boardId=BBS_0000957&menuCd=DOM_000000138002012000"
                                     f"&dataSid={sid}&command=update&fileSid={fsid}", q_[0])


# 시도 → (어댑터, 사용자 칸으로 거를 직함). 직함이 None 이면 게시물 자체가 단체장 것이다.
ADAPTERS: dict[str, tuple[Callable[[httpx.Client, str], Iterator[Table]], str | None]] = {
    "서울특별시": (seoul, None),
    "부산광역시": (busan, "시장"),
    "제주특별자치도": (jeju, None),
    "강원특별자치도": (gangwon, None),
    "경기도": (gyeonggi, None),
    "인천광역시": (incheon, None),
    "대전광역시": (daejeon, "시장"),
    "울산광역시": (ulsan, None),
    "세종특별자치시": (sejong, None),
    "충청북도": (chungbuk, None),
    "전북특별자치도": (jeonbuk, None),
    "경상북도": (gyeongbuk, None),
    "경상남도": (gyeongnam, "도지사"),
}


# --------------------------------------------------------------------------- 저장

COLS = ["source_url", "seq", "org", "period", "used_at", "place", "purpose",
        "amount", "headcount", "payment", "kind"]


def run(conn, orgs: list[str], since: str) -> int:
    total = 0
    with httpx.Client(timeout=60, headers=UA, follow_redirects=True) as c, conn.cursor() as cur:
        cur.execute("select distinct source_url from head_expense")
        seen = {r[0] for r in cur.fetchall()}
        for org in orgs:
            adapter, head = ADAPTERS[org]
            got = 0
            try:
                # 한 파일에 시트가 여럿(기관운영·시책추진)이라 표는 기간 단위로 모아 한 번에 쓴다.
                by_period: dict[str, list[Table]] = {}
                for t in adapter(c, since):
                    by_period.setdefault(t[1], []).append(t)
                for period, tables in sorted(by_period.items()):
                    if {t[0] for t in tables} <= seen:
                        continue
                    rows, seq = [], {}
                    for t in tables:
                        for r in norm(org, t, head):
                            seq[r[0]] = seq.get(r[0], 0) + 1
                            rows.append((r[0], seq[r[0]], *r[1:]))
                    if not rows:
                        print(f"  {org} {period} 행 0 — 머리줄 {tables[0][2]}", file=sys.stderr)
                        continue
                    # 같은 기간이 고쳐서 다시 올라왔으면 옛 줄을 통째로 바꾼다.
                    cur.execute("delete from head_expense where org=%s and period=%s", (org, period))
                    cur.executemany(
                        f"insert into head_expense ({','.join(COLS)})"
                        f" values ({','.join(['%s'] * len(COLS))})", rows)
                    seen |= {t[0] for t in tables}
                    got += len(rows)
                conn.commit()
            except Exception as e:                   # 한 곳이 막혀도 나머지는 받는다
                conn.rollback()
                print(f"  {org} 실패: {type(e).__name__} {str(e)[:150]}", file=sys.stderr)
                continue
            print(f"  {org} {got:,}건", file=sys.stderr)
            total += got
        cur.execute("insert into ingest_run (source, finished_at, rows) values ('expense', now(), %s)",
                    (total,))
        conn.commit()
    print(f"[expense] {total:,}건", file=sys.stderr)
    return total


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["fetch"])
    p.add_argument("--org", action="append", help="시도 이름. 여러 번 줄 수 있다. 없으면 전부")
    p.add_argument("--since", default=TERM_START)
    a = p.parse_args()
    orgs = a.org or list(ADAPTERS)
    if bad := [o for o in orgs if o not in ADAPTERS]:
        sys.exit(f"어댑터 없음: {bad}")
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        run(conn, orgs, a.since)


if __name__ == "__main__":
    main()

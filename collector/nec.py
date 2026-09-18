#!/usr/bin/env python3
"""중앙선거관리위원회 수집기 — 모든 선출직의 당선인·출마이력·공약.

사용:
    python nec.py elections                  # 역대 선거 목록 (192건: 선거 x 선거종류)
    python nec.py winners --office 시도지사    # 당선인 + 출마이력
    python nec.py winners --all              # 지원 직위 전부
    python nec.py pledges --office 교육감      # 공약 (공약 API 지원 직위만)
    python nec.py all

환경변수: DATABASE_URL, DATA_GO_KR_KEY
    키 발급: https://www.data.go.kr 로그인 > 아래 4개 API 각각 '활용신청'
      중앙선거관리위원회_선거 코드 정보 / 당선인 정보 / 후보자 정보 / 선거공약 정보
    자동승인이라 신청 즉시 쓸 수 있다. 인코딩 키든 디코딩 키든 그대로 넣으면 된다.

국회의원은 열린국회정보(ingest.py)가 의정활동까지 주므로 여기서는 출마 이력만 쓴다.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from urllib.parse import unquote

import httpx
import psycopg

from ingest import d, upsert

BASE = "https://apis.data.go.kr/9760000"

# 포털은 '인코딩 키'(%2B 등이 든 것)와 '디코딩 키'를 둘 다 보여준다.
# httpx 가 params 를 다시 인코딩하므로 인코딩 키를 그대로 주면 이중 인코딩돼
# SERVICE_KEY_IS_NOT_REGISTERED_ERROR 가 난다. 받은 게 어느 쪽이든 원문으로 되돌린다.
KEY = os.getenv("DATA_GO_KR_KEY") or None
if KEY and "%" in KEY:
    KEY = unquote(KEY)

OPS = {
    "sg_code": f"{BASE}/CommonCodeService/getCommonSgCodeList",
    "winner": f"{BASE}/WinnerInfoInqireService2/getWinnerInfoInqire",
    "candidate": f"{BASE}/PofelcddInfoInqireService/getPofelcddRegistSttusInfoInqire",
    "pledge": f"{BASE}/ElecPrmsInfoInqireService/getCnddtElecPrmsInfoInqire",
}

# data.nec.go.kr LOD 전수 대조로 확인한 선거종류코드.
SG_TYPES = {
    "1": ("대통령", True),
    "2": ("국회의원", False),
    "3": ("시도지사", True),
    "4": ("구시군의장", True),
    "5": ("시도의원", False),
    "6": ("구시군의원", False),
    "7": ("국회의원비례대표", False),
    "8": ("시도의원비례대표", False),
    "9": ("구시군의원비례대표", False),
    "10": ("교육의원", False),
    "11": ("교육감", True),
}
# 선거공약서 제출 대상 = 선거공약 API 가 공약을 주는 직위. 나머지는 선거공보 PDF 뿐.
PLEDGE_TYPES = {c for c, (_, has) in SG_TYPES.items() if has}
OFFICE_CODE = {name: code for code, (name, _) in SG_TYPES.items()}

# 비례대표는 별도 선거로 치러지지만 당선되면 같은 직위다. 화면에서는 하나로 묶는다.
OFFICE_GROUP = {"국회의원비례대표": "국회의원", "시도의원비례대표": "시도의원",
                "구시군의원비례대표": "구시군의원"}
PROPORTIONAL = {"7", "8", "9"}


def office_of(code: str) -> str:
    name = SG_TYPES.get(code, ("기타", False))[0]
    return OFFICE_GROUP.get(name, name)


def fetch(op: str, **params) -> list[dict]:
    """페이지를 돌며 전체 row 를 모은다. 데이터 없음(INFO-200 류)은 빈 리스트."""
    if not KEY:
        raise RuntimeError(
            "DATA_GO_KR_KEY 가 필요합니다. https://www.data.go.kr 에서 선관위 API 4종을"
            " 활용신청(자동승인)하고 일반 인증키(Decoding)를 .env 에 넣으세요."
        )
    url = OPS[op]
    out: list[dict] = []
    page = 1
    with httpx.Client(timeout=60, headers={"User-Agent": "nureongso/0.1"}) as c:
        while True:
            q = {"serviceKey": KEY, "resultType": "json", "pageNo": page,
                 "numOfRows": 100, **params}
            for attempt in range(3):
                try:
                    r = c.get(url, params=q)
                    data = r.json()
                    break
                except Exception as e:
                    if attempt == 2:
                        raise RuntimeError(f"{op} {params}: {e}") from e
                    time.sleep(2 * (attempt + 1))

            rows, total = parse(data, op, params)
            if rows is None:  # 데이터 없음
                return []
            out.extend(rows)
            if len(out) >= total or not rows:
                break
            page += 1
    return out


def parse(data: dict, op: str, params: dict) -> tuple[list[dict] | None, int]:
    """공공데이터포털 표준 응답 껍데기를 벗긴다. (rows, 총건수). 데이터 없음이면 (None, 0).

    실제 형태: {"response": {"header": {"resultCode": "INFO-00"},
                             "body": {"items": {"item": [...]}, "totalCount": N}}}
    """
    if "OpenAPI_ServiceResponse" in data:  # 인증·경로 오류는 이 껍데기로 온다
        m = data["OpenAPI_ServiceResponse"]["cmmMsgHeader"]
        raise RuntimeError(f"{op}: {m.get('errMsg')} ({m.get('returnAuthMsg')})")

    r = data.get("response")
    if r is None:
        raise RuntimeError(f"{op} {params}: 예상치 못한 응답 {list(data)[:5]}")
    code = str(r.get("header", {}).get("resultCode", ""))
    if code.startswith("INFO-0") and code != "INFO-00":
        return None, 0  # INFO-03 등 = 해당 조건에 데이터 없음
    if not code.startswith("INFO-00"):
        raise RuntimeError(f"{op} {params}: {code} {r.get('header', {}).get('resultMsg')}")

    body = r.get("body") or {}
    items = body.get("items")
    rows = items.get("item") if isinstance(items, dict) else items
    if isinstance(rows, dict):  # 1건이면 리스트가 아니라 객체로 온다
        rows = [rows]
    return rows or [], int(body.get("totalCount") or 0)


# --------------------------------------------------------------------------- 선거


def ingest_elections(cur) -> int:
    rows = fetch("sg_code")
    out = []
    for r in rows:
        code = d(r.get("sgTypecode"))
        out.append((
            d(r.get("sgId")), code, d(r.get("sgName")), d(r.get("sgVotedate")),
            office_of(code),
        ))
    upsert(cur, "election", ["sg_id", "sg_typecode", "name", "vote_date", "office"],
           out, "sg_id,sg_typecode")
    return len(out)


def elections_for(cur, office: str) -> list[str]:
    code = OFFICE_CODE[office]
    cur.execute(
        "select sg_id from election where sg_typecode = %s order by sg_id desc", (code,)
    )
    return [r[0] for r in cur.fetchall()]


# --------------------------------------------------------------------------- 당선인


def ingest_winners(cur, office: str, latest_only: bool = False) -> int:
    code = OFFICE_CODE[office]
    sg_ids = elections_for(cur, office)
    if latest_only:
        sg_ids = sg_ids[:1]
    if not sg_ids:
        print(f"  {office}: 해당 선거가 없습니다. 먼저 `nec.py elections` 를 실행하세요.",
              file=sys.stderr)
        return 0

    total = 0
    for sg_id in sg_ids:
        rows = fetch("winner", sgId=sg_id, sgTypecode=code)
        if not rows:
            continue
        cands = []
        for r in rows:
            cands.append((
                d(r.get("sgId")), code, office_of(code), d(r.get("huboid")),
                d(r.get("name")), birth_of(r.get("birthday")),
                d(r.get("jdName")), d(r.get("sggName")), d(r.get("sdName")),
                d(r.get("wiwName")), d(r.get("giho")),
                num(r.get("dugsu")), num(r.get("dugyul")),
                d(r.get("job")), d(r.get("edu")),
                " / ".join(x for x in [d(r.get("career1")), d(r.get("career2"))] if x),
                True,
            ))
        upsert(
            cur, "candidacy",
            ["election_id", "sg_typecode", "office", "huboid", "name", "birth",
             "party", "district", "sd_name", "wiw_name", "giho", "votes", "vote_rate",
             "job", "edu", "career", "elected"],
            cands, "election_id,sg_typecode,huboid",
        )
        # 가장 최근 선거의 당선인만 현직이다. 과거 선거는 이력으로만 남긴다.
        register_members(cur, sg_id, code, current=(sg_id == sg_ids[0]))
        total += len(cands)
        print(f"  {office} {sg_id}: {len(cands)}명", file=sys.stderr)
    sync_office(cur)
    return total


def sync_office(cur) -> None:
    """member.office 를 '가장 최근에 당선된 선거의 직위' 로 맞춘다.

    수집 순서에 의존하지 않는다. 국회의원이었다가 단체장이 된 사람은 단체장으로 바뀐다.
    """
    cur.execute("""
        update member m set office = c.office
        from (
          select distinct on (member_code) member_code, office
          from candidacy
          where elected and member_code is not null and office is not null
          order by member_code, election_id desc
        ) c
        where c.member_code = m.code and m.office is distinct from c.office
    """)


def register_members(cur, sg_id: str, code: str, current: bool = True) -> None:
    """당선인을 member 로 올리고 candidacy 에 연결한다.

    당선인 수집 단계에서 해야 한다. 공약 수집에 묻어두면 공약 API 가 없는 직위
    (시도의원 등)는 목록에 영영 안 뜬다.

    같은 이름·생년이 이미 있으면 그 코드를 쓴다. 국회의원이었다가 단체장이 된 사람은
    한 인물로 합쳐져 과거 발의 이력과 현재 공약이 같은 페이지에 모인다.

    current=False 는 지난 선거의 당선인이라 현직으로 올리면 안 된다는 뜻이다.
    이미 현직인 사람을 내리지는 않는다 (다른 선거에서 현직일 수 있다).
    """
    cur.execute(
        "select huboid, name, birth, party, district, office from candidacy"
        " where election_id = %s and sg_typecode = %s and huboid is not null",
        (sg_id, code),
    )
    elect_type = "비례대표" if code in PROPORTIONAL else "지역구"
    for huboid, name, birth, party, district, office in cur.fetchall():
        cur.execute(
            "select code from member where name = %s and birth = %s limit 1", (name, birth)
        )
        hit = cur.fetchone()
        mcode = hit[0] if hit else f"nec-{huboid}"
        # 이미 있는 사람의 값은 덮지 않는다. 열린국회정보 쪽이 더 자세하다
        # (예: 지역구가 '서울 종로구' vs 선관위 '종로구'). 빈 칸만 채운다.
        cur.execute(
            "insert into member (code, name, birth, party, district, office,"
            " elect_type, is_incumbent) values (%s,%s,%s,%s,%s,%s,%s,%s)"
            " on conflict (code) do update set"
            "   party        = coalesce(member.party, excluded.party),"
            "   district     = coalesce(member.district, excluded.district),"
            "   elect_type   = coalesce(member.elect_type, excluded.elect_type),"
            "   is_incumbent = member.is_incumbent or excluded.is_incumbent",
            (mcode, name, birth, party, district, office, elect_type, current),
        )
        cur.execute(
            "update candidacy set member_code = %s where election_id = %s"
            " and sg_typecode = %s and huboid = %s",
            (mcode, sg_id, code, huboid),
        )


def birth_of(v):
    """생년월일을 YYYY-MM-DD 로 통일.

    선관위는 '19670502', 열린국회정보는 '1967-05-02' 로 준다. 형식이 다르면
    이름+생년 매칭이 전부 빗나가 같은 사람이 둘로 갈린다. 실제로 1,255명이 갈렸었다.
    """
    v = d(v)
    if not v:
        return None
    digits = "".join(ch for ch in v if ch.isdigit())
    if len(digits) == 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    return v


def num(v):
    v = d(v)
    if not v:
        return None
    try:
        return float(v.replace(",", "").replace("%", ""))
    except ValueError:
        return None


# --------------------------------------------------------------------------- 공약


def ingest_pledges(cur, office: str, latest_only: bool = True) -> int:
    """선거공약 API. 공약서 제출 대상 직위만 제공한다(대통령/시도지사/구시군의장/교육감)."""
    code = OFFICE_CODE[office]
    if code not in PLEDGE_TYPES:
        print(f"  {office}: 선거공약 API 대상이 아닙니다 (공약서 제출 의무 없음).",
              file=sys.stderr)
        return 0

    sg_ids = elections_for(cur, office)
    if latest_only:
        sg_ids = sg_ids[:1]

    total = 0
    for sg_id in sg_ids:
        cur.execute(
            "select huboid, member_code from candidacy"
            " where election_id = %s and sg_typecode = %s"
            " and huboid is not null and member_code is not null",
            (sg_id, code),
        )
        people = cur.fetchall()
        if not people:
            print(f"  {office} {sg_id}: 당선인이 없습니다. 먼저 `nec.py winners` 를 실행하세요.",
                  file=sys.stderr)
            continue
        for huboid, mcode in people:
            rows = fetch("pledge", sgId=sg_id, sgTypecode=code, cnddtId=huboid)
            if not rows:
                continue
            r = rows[0]
            cur.execute(
                "insert into pledge_doc (member_code, election_id, kind)"
                " values (%s,%s,'공약서')"
                " on conflict (member_code, election_id, kind) do nothing",
                (mcode, sg_id),
            )
            cur.execute(
                "select id from pledge_doc where member_code = %s and election_id = %s"
                " and kind = '공약서'", (mcode, sg_id),
            )
            row = cur.fetchone()
            if not row:
                continue
            doc_id = row[0]
            cur.execute("delete from pledge where doc_id = %s", (doc_id,))
            items = []
            for i in range(1, 11):
                title = d(r.get(f"prmsTitle{i}"))
                if not title:
                    continue
                # 본문 필드는 prmsCont 가 아니라 prmmCont 다 (선관위 API 의 오타). 실측 확인.
                items.append((doc_id, mcode, sg_id, i, title,
                              d(r.get(f"prmmCont{i}")) or d(r.get(f"prmsCont{i}")),
                              d(r.get(f"prmsRealmName{i}"))))
            if items:  # 위에서 doc_id 기준으로 지웠으므로 그냥 넣는다
                cur.executemany(
                    "insert into pledge (doc_id, member_code, election_id, order_no,"
                    " title, body, category, source)"
                    " values (%s,%s,%s,%s,%s,%s,%s,'공약서')",
                    items,
                )
            total += len(items)
        print(f"  {office} {sg_id}: 공약 {total}건", file=sys.stderr)
    return total



# --------------------------------------------------------------------------- run

OFFICES = ["시도지사", "교육감", "구시군의장"]  # 늘리려면 여기에 추가.


def main():
    p = argparse.ArgumentParser()
    p.add_argument("step", choices=["elections", "winners", "pledges", "all"])
    p.add_argument("--office", default=None, help=f"기본값: {', '.join(OFFICES)}")
    p.add_argument("--all-elections", action="store_true",
                   help="역대 선거 전부 (기본은 최근 1회)")
    args = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    offices = [args.office] if args.office else OFFICES

    with psycopg.connect(dsn) as conn:
        if args.step in ("elections", "all"):
            with conn.cursor() as cur:
                n = ingest_elections(cur)
            conn.commit()
            print(f"[elections] {n}건", file=sys.stderr)

        if args.step in ("winners", "all"):
            for o in offices:
                with conn.cursor() as cur:
                    n = ingest_winners(cur, o, latest_only=not args.all_elections)
                conn.commit()
                print(f"[winners] {o} {n}명", file=sys.stderr)

        if args.step in ("pledges", "all"):
            for o in offices:
                with conn.cursor() as cur:
                    n = ingest_pledges(cur, o)
                conn.commit()
                print(f"[pledges] {o} {n}건", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""공약 이행 판정 — 사실 수집은 자동, 판정은 공개된 규칙으로.

이행 여부는 어느 기관도 공식 제공하지 않는다. 그래서 '사실' 과 '해석' 을 분리한다.

  classify     공약마다 무엇으로 이행을 확인할 수 있는지 유형을 붙인다 (LLM)
  match        입법형 공약을 본인 대표발의 법안과 대조해 근거를 붙인다 (LLM)
  match_ordin  조례제도형 공약을 그 지자체 자치법규와 대조한다 (LLM, 단체장·교육감)
  decide       근거를 보고 규칙표대로 판정한다 (LLM 없음, 몇 번 돌려도 같은 결과)

LLM 은 '이 공약과 이 기록이 같은 일인가' 만 판단한다. '이행됐다' 는 말은 decide 의
규칙표가 하고, 그건 SQL 이라 몇 번을 돌려도 같은 답이 나온다.

실측: 국회의원 공약의 10%만 입법형이고 60%는 지역 사업이다. 사업형은 아직 측정
수단이 없어 '측정 수단 없음' 으로 남긴다. 억지로 판정하는 쪽이 더 해롭다.

match_ordin 은 ordin.py 로 자치법규를 먼저 받아 둬야 한다.

사용:
    python judge.py classify --limit 5    # 먼저 소량으로 품질 확인
    python judge.py all
    python judge.py decide                # 규칙만 다시 적용

환경변수: DATABASE_URL + llm.py 가 쓰는 것 (기본 GEMINI_API_KEY)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import psycopg

import llm

# 공약을 무엇으로 잴 수 있는가. 이 다섯 가지 외에는 받지 않는다.
KINDS = ["입법", "예산사업", "조례제도", "선언", "기타"]

# 임기 시작일. '아직 안 했다' 와 '이제 시작했다' 를 가르는 기준일이라 직위별로 다르다.
MP_TERM_START = "2024-05-30"      # 제22대 국회 개원
HEAD_TERM_START = "2026-07-01"    # 제9회 지방선거 당선자 취임
GRACE_YEARS = 2

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "integer"},
                    "kinds": {"type": "array",
                              "items": {"type": "string", "enum": KINDS}},
                },
                "required": ["id", "kinds"],
            },
        }
    },
    "required": ["items"],
}

CLASSIFY_PROMPT = """한국 선거 공약 목록이다. 각 공약을 **무엇을 보면 이행 여부를 확인할 수 있는가**
기준으로 분류하라. 공약의 주제(교통·복지 등)가 아니라 '확인 수단' 으로 나누는 것이다.

유형:
- 입법: 국회가 법률을 만들거나 고쳐야 이뤄진다. 법안 발의·통과로 확인한다.
- 예산사업: 시설·도로·기관을 짓거나 유치하거나 사업을 벌인다. 예산 편성과 착공으로 확인한다.
- 조례제도: **지방자치단체** 조례나 지자체 행정 절차·지침 변경으로 이뤄진다.
- 선언: 확인할 수단이 없다. 무엇을 보면 이뤄졌는지 말할 수 없으면 선언이다.
- 기타: 위 어디에도 맞지 않는다.

**입법과 조례를 가르는 기준 (가장 자주 틀리는 부분)**
전국 어디서나 똑같이 적용되는 것은 법률이다. 조례는 그 지자체 안에서만 효력이 있다.
다음은 전부 **입법**이다. 조례로는 절대 못 한다:
  세금(취득세·양도세·종부세·소득세), 근로조건(근로시간·주4일제·휴가·최저임금),
  건강보험·국민연금 급여, 형벌과 수사권, 국가 자격·면허, 전국 단위 지원금·수당 제도.
반대로 그 지역 안에서만 정하는 것은 조례제도다:
  지자체 조례 제정, 구청 인허가 절차, 지역 시설 운영 방식, 지자체 자체 지원금.

**공약 하나에 서로 다른 수단이 섞여 있으면 해당하는 유형을 모두 쓴다.**
예: "복지 확대 — 유급휴가 1개월 확대, 복지관 건립" → ["입법","예산사업"]
    (유급휴가는 법 개정, 복지관은 예산)
하나만 고르려다 법률 공약을 놓치면 그 공약은 영원히 판정할 수 없게 된다.

단, **본문에 실제로 적혀 있는 수단만** 쓴다. "이걸 하려면 조례도 필요하겠지" 같은
추측으로 유형을 늘리지 마라. 대부분의 공약은 유형이 1개다.
"선언" 은 다른 유형과 함께 쓸 수 없다. 확인할 수단이 하나라도 있으면 선언이 아니다.

**선언으로 보내는 경우와 아닌 경우**
- 선언이다: "살기 좋은 도시", "소통하는 의정", "△△ 설치 **검토**" (검토는 하겠다는 말이 아니다)
- 선언이 아니다: 수단이 본문에 적혀 있으면 그 수단의 유형을 쓴다. 제목이 추상적이어도
  본문에 "간병비 건강보험 적용", "○○법 개정" 같은 구체적 수단이 있으면 입법이다.

모든 공약에 대해 {"items":[{"id":<id>,"kinds":["<유형>",...]}]} 형식으로 답하라.
빠뜨리지 마라. kinds 는 보통 1개, 섞였으면 2~3개다.

공약 목록:
{items}"""

MATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pledge_id": {"type": "integer"},
                    "bill_id": {"type": "string"},
                    "confidence": {"type": "number"},
                    "why": {"type": "string"},
                },
                "required": ["pledge_id", "bill_id", "confidence"],
            },
        }
    },
    "required": ["matches"],
}

MATCH_PROMPT = """어떤 국회의원의 '입법형 공약' 목록과, 그 의원이 **직접 대표발의한 법안** 목록이다.
각 공약을 이행하기 위해 발의한 것으로 보이는 법안을 찾아 연결하라.

규칙:
- 반드시 아래 법안 목록에 있는 bill_id 만 쓴다. 없는 id 를 지어내지 마라.
- 공약과 법안이 같은 문제를 다룰 때만 연결한다. 분야가 같다는 이유로 연결하지 마라.
  (예: 공약 '노인 간병비 지원' ↔ 법안 '노인복지법 개정' 은 내용이 맞아야만 연결)
- 한 공약에 법안이 여럿이면 여럿 다 쓴다. 맞는 법안이 없으면 그 공약은 빼라.
  **없는 것을 억지로 붙이는 쪽이 빠뜨리는 쪽보다 훨씬 해롭다.**
- confidence 는 0~1. 법안 이름만으로 판단하므로 확신이 없으면 낮게 준다.
- why 는 왜 연결했는지 한 줄 (40자 이내).

공약:
{pledges}

대표발의 법안:
{bills}"""


# --------------------------------------------------------------------------- classify


def run_classify(conn, limit: int | None, redo: bool) -> None:
    """의원 1명당 1회 호출. 그 사람 공약 전부를 한 번에 분류한다."""
    with conn.cursor() as cur:
        # 현직부터 돈다. 한도에 걸려 중간에 멈춰도 화면에 실제로 보이는 사람이 먼저 채워진다.
        # 지난 임기 공약도 그 사람이 현직이면 member_code 가 현직이라 같이 처리된다.
        cur.execute(
            "select p.member_code, count(*) from pledge p"
            " left join member m on m.code = p.member_code"
            + ("" if redo else " where p.kinds is null")
            + " group by p.member_code, m.is_incumbent"
            " order by m.is_incumbent desc nulls last, p.member_code"
        )
        targets = cur.fetchall()
    if limit:
        targets = targets[:limit]
    print(f"  대상 {len(targets)}명", file=sys.stderr)

    done = tagged = 0
    for i, (mcode, n) in enumerate(targets, 1):
        with conn.cursor() as cur:
            cur.execute(
                "select id, title, coalesce(body,'') from pledge where member_code = %s"
                + ("" if redo else " and kinds is null"),
                (mcode,),
            )
            rows = cur.fetchall()
        if not rows:
            continue
        listing = "\n".join(f'{pid}. {t} / {b[:200]}' for pid, t, b in rows)

        try:
            out = llm.complete_json(
                CLASSIFY_PROMPT.replace("{items}", listing), CLASSIFY_SCHEMA)
        except llm.QuotaExhausted as e:
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  키별 성공: {llm.key_usage()}", file=sys.stderr)
            print(f"  {len(targets) - i + 1}명이 남았습니다. 한도 회복 후 같은 명령을"
                  " 다시 실행하면 남은 것만 처리합니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            print(f"  [{i}/{len(targets)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        valid = {pid for pid, _, _ in rows}
        pairs = []
        for it in out.get("items", []):
            if it.get("id") not in valid:
                continue
            ks = set(k for k in (it.get("kinds") or []) if k in KINDS)
            # '선언' 은 '확인할 수단이 없다' 는 뜻이라 다른 유형과 같이 설 수 없다.
            if len(ks) > 1:
                ks.discard("선언")
            if ks:
                pairs.append((sorted(ks), it["id"]))
        with conn.cursor() as cur:
            cur.executemany("update pledge set kinds = %s where id = %s", pairs)
        conn.commit()
        done += 1
        tagged += len(pairs)
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 의원 {done}명 공약 {tagged}건", file=sys.stderr)

    print(f"[classify] 의원 {done}명, 공약 {tagged}건 분류", file=sys.stderr)


# --------------------------------------------------------------------------- match


def run_match(conn, limit: int | None, redo: bool) -> None:
    """입법형 공약 ↔ 본인 대표발의 법안. 공동발의는 서명일 뿐이라 근거로 쓰지 않는다."""
    with conn.cursor() as cur:
        # 이미 돌린 의원은 건너뛴다. '매칭 0건' 과 '아직 안 돌림' 을 구별해야 해서
        # 근거 유무가 아니라 실행 기록(ingest_run)으로 판단한다.
        cur.execute(
            """
            select p.member_code, count(*)
            from pledge p
            where '입법' = any(p.kinds)
              and exists (select 1 from bill_sponsor s
                           where s.member_code = p.member_code and s.role = 'rep')
              %s
            group by p.member_code order by count(*) desc
            """ % ("" if redo else
                   "and not exists (select 1 from ingest_run r"
                   " where r.source = 'match:' || p.member_code)")
        )
        targets = cur.fetchall()
    if limit:
        targets = targets[:limit]
    print(f"  대상 {len(targets)}명", file=sys.stderr)

    done = linked = 0
    for i, (mcode, n) in enumerate(targets, 1):
        with conn.cursor() as cur:
            cur.execute(
                "select id, title, coalesce(body,'') from pledge"
                " where member_code = %s and '입법' = any(kinds) order by id", (mcode,))
            pledges = cur.fetchall()
            cur.execute(
                "select bill_id, name, coalesce(proc_result,'계류') from member_bill"
                " where member_code = %s and role = 'rep' order by proposed_at desc",
                (mcode,))
            bills = cur.fetchall()
        if not pledges or not bills:
            continue

        out = None
        try:
            out = llm.complete_json(
                MATCH_PROMPT.format(
                    pledges="\n".join(f"{p}. {t} / {b[:150]}" for p, t, b in pledges),
                    bills="\n".join(f"{bid} | {nm} | {res}" for bid, nm, res in bills),
                ), MATCH_SCHEMA)
        except llm.QuotaExhausted as e:
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  키별 성공: {llm.key_usage()}", file=sys.stderr)
            print(f"  {len(targets) - i + 1}명이 남았습니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            print(f"  [{i}/{len(targets)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        pids = {p for p, _, _ in pledges}
        bids = {b for b, _, _ in bills}
        rows = [
            (m["pledge_id"], "bill", m["bill_id"],
             float(m.get("confidence") or 0), (m.get("why") or "")[:300])
            for m in out.get("matches", [])
            # 없는 id 는 버린다. 모델이 지어낸 근거가 화면에 뜨면 신뢰가 무너진다.
            if m.get("pledge_id") in pids and m.get("bill_id") in bids
        ]
        with conn.cursor() as cur:
            cur.executemany(
                "insert into pledge_evidence (pledge_id, kind, ref_id, score, summary)"
                " values (%s,%s,%s,%s,%s)"
                " on conflict (pledge_id, kind, ref_id) do update set"
                "   score = excluded.score, summary = excluded.summary", rows)
            cur.execute(
                "insert into ingest_run (source, finished_at, rows)"
                " values ('match:' || %s, now(), %s)", (mcode, len(rows)))
        conn.commit()
        done += 1
        linked += len(rows)
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] 의원 {done}명 근거 {linked}건", file=sys.stderr)

    print(f"[match] 의원 {done}명, 공약-법안 연결 {linked}건", file=sys.stderr)


# --------------------------------------------------------------------------- match_ordin

ORDIN_PROMPT = """어떤 지방자치단체장(또는 교육감)의 '조례·제도형 공약' 목록과, 그 지자체가
**취임 이후 제정·개정한 자치법규** 후보 목록이다. 각 공약을 이행한 것으로 보이는
자치법규를 찾아 연결하라.

규칙:
- 반드시 아래 목록에 있는 ordin_id 만 쓴다. 없는 id 를 지어내지 마라.
- 공약과 조례가 **같은 대상에게 같은 일을 하는 것**일 때만 연결한다. 분야가 같다는
  이유로 연결하지 마라. (공약 '청년 월세 지원' ↔ 조례 '청년 기본 조례' 는 다르다)
- 이름이 비슷하다고 붙이지 마라. 후보는 글자 유사도로 뽑은 것이라 무관한 게 섞여 있다.
- 맞는 조례가 없으면 그 공약은 빼라. **없는 것을 억지로 붙이는 쪽이 빠뜨리는 쪽보다
  훨씬 해롭다.** 대부분의 공약은 맞는 조례가 없는 것이 정상이다.
- confidence 는 0~1. 조례명만으로 판단하므로 확신이 없으면 낮게 준다.
- why 는 왜 연결했는지 한 줄 (40자 이내).

공약:
{pledges}

자치법규 후보:
{ordins}"""

ORDIN_SCHEMA = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pledge_id": {"type": "integer"},
                    "ordin_id": {"type": "string"},
                    "confidence": {"type": "number"},
                    "why": {"type": "string"},
                },
                "required": ["pledge_id", "ordin_id", "confidence"],
            },
        }
    },
    "required": ["matches"],
}

# 후보를 뽑는 문턱과 개수.
#
# similarity() 가 아니라 word_similarity() 를 쓴다. 조례명은 '김해시 민생지원금 지원
# 조례' 처럼 지자체명과 '조례' 가 붙어 있고 공약 제목은 '전 시민 대상 민생지원금 지급'
# 이라 문자열 전체를 비교하면 겹치는 부분이 묻힌다. 실측으로 후보가 잡힌 공약이
# similarity 로는 884건 중 32건뿐인데 word_similarity 로는 234건이다.
#
# 문턱이 낮아 무관한 것이 잔뜩 섞여 온다 ('평등하고 존중받는 도시 조성' ↔ '생활임금'
# 이 0.80 으로 나온다). 걸러내는 건 LLM 의 몫이고, 여기는 놓치지 않는 것만 한다.
ORDIN_SIM = 0.3
ORDIN_TOP = 40
# 조례명에서 지자체 접두사와 '조례/규칙' 꼬리를 뗀 알맹이. 이걸로 비교해야 맞는다.
ORDIN_CORE = (r"regexp_replace(regexp_replace(o.name, '^'||o.org||'\s*', ''),"
              r" '\s*(조례|규칙)(\s*시행규칙)?$', '')")


# 선관위 시도명 → 법제처 지자체기관명. 선관위 기록은 선거 당시 이름으로 남아 있어서
# 통합·개칭이 반영되지 않는다. 지금은 전남·광주 통합 하나뿐이지만, 강원도가
# 강원특별자치도가 됐듯 또 생긴다. 못 찾은 지자체는 조용히 버리지 말고 경고한다.
SIDO_ALIAS = {
    "광주광역시": "전남광주통합특별시",
    "전라남도": "전남광주통합특별시",
}


def ordin_org(office: str, sd_name: str, district: str) -> str:
    """이 사람의 조례를 찾을 '지자체기관명'.

    구시군의장은 시도 + 시군구 다 있어야 한다 — '남구' 는 네 곳이다. 그 시군구 이름은
    member_area 의 wiw_name 이 아니라 candidacy.district 를 쓴다. wiw_name 은 선거관리
    위원회가 맡은 구역이라 '고양시덕양구' 처럼 조례를 만들 수 없는 행정구가 들어온다
    (실측: 243곳 중 43곳이 이래서 안 맞았다).

    교육감의 조례는 지자체가 아니라 교육청이 만든다 ('서울특별시교육청 ○○ 조례').
    """
    sido = SIDO_ALIAS.get(sd_name, sd_name)
    if office == "구시군의장":
        return f"{sido} {district}"
    if office == "교육감":
        return f"{sido}교육청"
    return sido


def run_match_ordin(conn, limit: int | None, redo: bool) -> None:
    """조례제도형 공약 ↔ 그 지자체가 취임 후 제·개정한 자치법규.

    국회의원은 대상이 아니다. 의원은 조례를 만들 수 없다 — 의원의 조례제도형 공약
    554건은 애초에 잴 수단이 없는 것이고, 그걸 남의 지자체 조례로 채우면 거짓이 된다.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            select p.member_code, a.office, a.sd_name,
                   (select c.district from candidacy c
                     where c.member_code = p.member_code and c.elected
                       and c.office = a.office
                     order by c.election_id desc limit 1) as district,
                   count(*)
            from pledge p
            join member_area a on a.member_code = p.member_code
            where '조례제도' = any(p.kinds)
              and a.office <> '국회의원'
              %s
            group by 1, 2, 3, 4 order by 5 desc
            """ % ("" if redo else
                   "and not exists (select 1 from ingest_run r"
                   " where r.source = 'ordin:' || p.member_code)")
        )
        rows = cur.fetchall()
        cur.execute("select distinct org from ordinance")
        known = {o for (o,) in cur.fetchall()}

    targets, missing = [], []
    for mcode, office, sd, district, n in rows:
        org = ordin_org(office, sd, district or "")
        (targets if org in known else missing).append((mcode, org, n))
    if missing:
        # 조례가 한 건도 없는 지자체는 실제로 있을 수 있다(취임 직후). 그래도 이름이
        # 틀려서 못 찾는 것과 구별이 안 되므로 반드시 눈에 보이게 적는다.
        print(f"  ! 자치법규에서 못 찾은 지자체 {len(missing)}곳:"
              f" {', '.join(o for _, o, _ in missing[:8])}"
              f"{' …' if len(missing) > 8 else ''}", file=sys.stderr)
    if limit:
        targets = targets[:limit]
    print(f"  대상 {len(targets)}명", file=sys.stderr)

    done = linked = 0
    for i, (mcode, org, n) in enumerate(targets, 1):
        with conn.cursor() as cur:
            cur.execute(
                "select id, title, coalesce(body,'') from pledge"
                " where member_code = %s and '조례제도' = any(kinds) order by id", (mcode,))
            pledges = cur.fetchall()
            # 그 지자체 것만, 공약 제목과 글자가 겹치는 순으로. 조례 전체를 넘기면
            # 한 지자체에 수백 건이라 프롬프트가 감당이 안 된다.
            cur.execute(
                "select o.id, o.name, o.rr_kind, o.effective_at,"
                "       max(word_similarity(" + ORDIN_CORE + ","
                "           p.title || ' ' || coalesce(p.body,''))) as sim"
                " from ordinance o, pledge p"
                " where o.org = %s and p.member_code = %s"
                "   and '조례제도' = any(p.kinds)"
                "   and word_similarity(" + ORDIN_CORE + ","
                "       p.title || ' ' || coalesce(p.body,'')) > %s"
                " group by o.id, o.name, o.rr_kind, o.effective_at"
                " order by sim desc limit %s",
                (org, mcode, ORDIN_SIM, ORDIN_TOP))
            ordins = cur.fetchall()
        if not pledges or not ordins:
            # 후보가 없으면 '안 돌린 것' 이 아니라 '돌렸는데 없는 것' 이다. 기록을
            # 남겨야 판정에서 '미착수' 로 갈 수 있다.
            with conn.cursor() as cur:
                cur.execute("insert into ingest_run (source, finished_at, rows)"
                            " values ('ordin:' || %s, now(), 0)", (mcode,))
            conn.commit()
            continue

        try:
            out = llm.complete_json(
                ORDIN_PROMPT.format(
                    pledges="\n".join(f"{p}. {t} / {b[:150]}" for p, t, b in pledges),
                    ordins="\n".join(f"{oid} | {nm} | {rr} | {ef}"
                                     for oid, nm, rr, ef, _ in ordins),
                ), ORDIN_SCHEMA)
        except llm.QuotaExhausted as e:
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  키별 성공: {llm.key_usage()}", file=sys.stderr)
            print(f"  {len(targets) - i + 1}명이 남았습니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            print(f"  [{i}/{len(targets)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        pids = {p for p, _, _ in pledges}
        oids = {o for o, _, _, _, _ in ordins}
        rows = [
            (m["pledge_id"], "ordin", m["ordin_id"],
             float(m.get("confidence") or 0), (m.get("why") or "")[:300])
            for m in out.get("matches", [])
            if m.get("pledge_id") in pids and m.get("ordin_id") in oids
        ]
        with conn.cursor() as cur:
            cur.executemany(
                "insert into pledge_evidence (pledge_id, kind, ref_id, score, summary)"
                " values (%s,%s,%s,%s,%s)"
                " on conflict (pledge_id, kind, ref_id) do update set"
                "   score = excluded.score, summary = excluded.summary", rows)
            cur.execute(
                "insert into ingest_run (source, finished_at, rows)"
                " values ('ordin:' || %s, now(), %s)", (mcode, len(rows)))
        conn.commit()
        done += 1
        linked += len(rows)
        if i % 20 == 0 or i == len(targets):
            print(f"  [{i}/{len(targets)}] {done}명 근거 {linked}건", file=sys.stderr)

    print(f"[match_ordin] {done}명, 공약-조례 연결 {linked}건", file=sys.stderr)


# --------------------------------------------------------------------------- decide

# 판정 규칙. 서비스에 그대로 공개한다. 사람 판단이 아니라 표를 따르므로 재현 가능하다.
#
# 잴 수 있는 유형은 둘뿐이다:
#   입법      — 본인 대표발의 법안 (누구나)
#   조례제도  — 그 지자체가 취임 후 제·개정한 자치법규 (단체장·교육감만.
#               국회의원은 조례를 만들 수 없으므로 의원의 조례제도형은 계속 판단불가다)
# 예산사업·선언·기타는 아직 수단이 없다.
#
# 한 공약에 유형이 섞여 있고 잴 수 없는 쪽이 남아 있으면 '완료' 라고 하지 않는다.
# '노인복지 확대 — 노인복지법 개정, 복지관 건립' 에서 법 개정이 통과됐다고 복지관이
# 지어진 건 아니다. 이런 건 '진행' 까지만 간다.
DECIDE_SQL = """
with ev as (
  select e.pledge_id,
         max(e.score) as conf,
         -- psycopg 는 주석까지 훑어 퍼센트 기호를 파라미터로 본다. 리터럴은 두 번 써야 한다.
         bool_or(e.kind = 'bill' and b.proc_result like '%%가결%%') as law_passed,
         count(*) filter (where e.kind = 'bill')  as law_n,
         count(*) filter (where e.kind = 'ordin') as ordin_n
  from pledge_evidence e
  left join bill b on b.bill_id = e.ref_id and e.kind = 'bill'
  where e.kind in ('bill', 'ordin')
  group by e.pledge_id
),
base as (
  select p.id as pledge_id, p.kinds, ev.conf,
         coalesce(ev.law_passed, false) as law_passed,
         coalesce(ev.law_n, 0)   as law_n,
         coalesce(ev.ordin_n, 0) as ordin_n,
         coalesce(m.office, '국회의원') as office,
         -- 임기 시작일. 국회의원과 단체장은 선거도 취임도 다른 날이다.
         case when coalesce(m.office,'국회의원') = '국회의원'
              then %(mp_start)s::date else %(head_start)s::date end as term_start,
         -- 잴 수 있는 유형 / 잴 수 없는 유형
         array(select k from unnest(p.kinds) k
                where k = '입법'
                   or (k = '조례제도' and coalesce(m.office,'국회의원') <> '국회의원')
              ) as measurable,
         array(select k from unnest(p.kinds) k
                where k <> '입법'
                  and not (k = '조례제도' and coalesce(m.office,'국회의원') <> '국회의원')
              ) as unmeasurable,
         exists (select 1 from ingest_run r
                  where r.source = 'match:' || p.member_code) as law_checked,
         exists (select 1 from ingest_run r
                  where r.source = 'ordin:' || p.member_code) as ordin_checked
  from pledge p
  left join ev on ev.pledge_id = p.id
  left join member m on m.code = p.member_code
  where p.kinds is not null
),
flag as (
  select b.*,
    -- 이 공약에 필요한 대조를 다 돌렸는가. 안 돌렸으면 '없다' 고 말할 수 없다.
    (not ('입법' = any(b.measurable)) or b.law_checked)
    and (not ('조례제도' = any(b.measurable)) or b.ordin_checked) as checked,
    -- 잴 수 있는 쪽에서 실제로 이뤄진 증거가 나왔는가
    (b.law_passed or b.ordin_n > 0) as achieved,
    b.term_start + (%(grace)s || ' years')::interval < now() as past_grace
  from base b
),
judged as (
  select pledge_id,
    case
      when cardinality(measurable) = 0    then '판단불가'
      when achieved and cardinality(unmeasurable) = 0 then '완료'
      when achieved                       then '진행'
      when law_n > 0                      then '진행'
      when not checked                    then '판단불가'
      when past_grace                     then '미착수'
      else '판단불가'
    end as status,
    case
      when cardinality(measurable) = 0
           then 'no_measure:' || array_to_string(kinds, '+')
      when achieved and cardinality(unmeasurable) > 0
           then 'partial:' || array_to_string(unmeasurable, '+')
      when ordin_n > 0                    then 'ordin_enacted'
      when law_passed                     then 'law_passed'
      when law_n > 0                      then 'law_filed'
      when not checked                    then 'not_checked'
      when past_grace                     then 'none_2y'
      else 'none_early'
    end as note,
    conf
  from flag
)
insert into pledge_status (pledge_id, status, confidence, decided_by, note, updated_at)
select pledge_id, status, conf, 'auto', note, now() from judged
on conflict (pledge_id) do update set
  status = excluded.status, confidence = excluded.confidence,
  note = excluded.note, updated_at = now()
-- 사람이 확정한 판정은 절대 덮지 않는다.
where pledge_status.decided_by = 'auto'
"""


def run_decide(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(DECIDE_SQL, {"mp_start": MP_TERM_START,
                                 "head_start": HEAD_TERM_START,
                                 "grace": GRACE_YEARS})
        n = cur.rowcount
        cur.execute("refresh materialized view concurrently member_stats")
    conn.commit()
    with conn.cursor() as cur:
        cur.execute("select status, note, count(*) from pledge_status"
                    " group by status, note order by count(*) desc")
        for st, note, c in cur.fetchall():
            print(f"  {st:6} {note:22} {c:6,}건", file=sys.stderr)
    print(f"[decide] {n:,}건 판정 (규칙 적용, LLM 없음)", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument(
        "step", choices=["classify", "match", "match_ordin", "decide", "all"])
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--redo", action="store_true")
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        if a.step in ("classify", "all"):
            run_classify(conn, a.limit, a.redo)
        if a.step in ("match", "all"):
            run_match(conn, a.limit, a.redo)
        if a.step in ("match_ordin", "all"):
            run_match_ordin(conn, a.limit, a.redo)
        if a.step in ("decide", "all"):
            run_decide(conn)


if __name__ == "__main__":
    main()

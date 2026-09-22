#!/usr/bin/env python3
"""선거공보 텍스트 → 공약 목록.

선거공보 PDF 는 다단 편집이라 텍스트 추출본의 줄 순서가 뒤엉킨다. 규칙 기반 파싱은
포기하고 LLM 에 맡긴다. 대신 지어내지 못하도록 스키마를 강제하고, 원문에 없는 내용은
넣지 말라고 명시한다.

사용:
    python parse_pledges.py --sg 20240410 --limit 3     # 먼저 소량으로 품질 확인
    python parse_pledges.py --sg 20240410               # 전체
    python parse_pledges.py --sg 20240410 --redo        # 이미 한 것도 다시
    python parse_pledges.py --sg 20240410 --empty       # 공약 0건으로 남은 것만 다시

환경변수: DATABASE_URL + llm.py 가 쓰는 것 (기본 GEMINI_API_KEY)
"""
from __future__ import annotations

import argparse
import os
import re
import sys

import psycopg

import bulletin
import llm

# 선거공보는 공약 외에 학력·경력·재산·병역 신고내역이 절반을 차지한다.
# 그래도 통째로 넣는다. 잘라내려다 공약을 날리는 쪽이 더 나쁘다.
MAX_CHARS = 60_000

# 글꼴에 문자 매핑(ToUnicode)이 없는 PDF 는 텍스트가 (cid:NNNN) 으로 나온다.
# 이런 공보는 추출본으로 읽어봐야 소용이 없어 PDF 원본을 그대로 모델에 넘긴다.
CID = re.compile(r"\(cid:\d+\)")
CID_LIMIT = 0.05


def cid_ratio(text: str) -> float:
    return sum(len(x) for x in CID.findall(text)) / (len(text) or 1)

SCHEMA = {
    "type": "object",
    "properties": {
        "pledges": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "body": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["title", "category"],
            },
        }
    },
    "required": ["pledges"],
}

PROMPT = """아래는 한국 선거의 '선거공보' PDF 에서 추출한 텍스트다.
다단 편집이라 줄 순서가 뒤엉켜 있고 학력·경력·재산신고 같은 공약이 아닌 내용도 섞여 있다.

이 후보가 내건 **공약**만 뽑아서 JSON 으로 정리하라.

규칙:
- 원문에 있는 내용만 쓴다. 없는 공약을 지어내지 마라. 문장을 매끄럽게 다듬는 것은 괜찮다.
- 공약이 아닌 것은 제외: 학력, 경력, 재산·병역·납세·전과 신고내역, 인사말, 상대 후보 비판,
  정당 소개, 투표 안내.
- title 은 공약 한 줄 요약(40자 이내). body 는 원문에 적힌 세부 내용(없으면 빈 문자열).
- category 는 다음 중 하나: 교통, 주택·도시, 교육, 복지·보육, 경제·일자리, 안전, 환경,
  문화·체육, 의료, 행정·재정, 농림수산, 기타
- 큰 공약 아래 세부 항목이 딸려 있으면 큰 공약을 하나로 묶고 세부는 body 에 넣는다.
- 공약을 찾을 수 없으면 빈 배열을 반환한다.

--- 선거공보 텍스트 시작 ---
{text}
--- 선거공보 텍스트 끝 ---"""

# 텍스트가 깨진 공보는 PDF 를 그대로 넘긴다. 규칙은 같고 입력만 다르다.
PDF_PROMPT = PROMPT.split("--- 선거공보 텍스트 시작 ---")[0].replace(
    "아래는 한국 선거의 '선거공보' PDF 에서 추출한 텍스트다.\n"
    "다단 편집이라 줄 순서가 뒤엉켜 있고 학력·경력·재산신고 같은 공약이 아닌 내용도 섞여 있다.",
    "첨부한 PDF 는 한국 선거의 '선거공보' 다.\n"
    "학력·경력·재산신고 같은 공약이 아닌 내용도 섞여 있다.",
)


def parse_one(text: str, pdf: bytes | None = None) -> list[dict]:
    if pdf:
        prompt = PDF_PROMPT
    else:
        prompt = PROMPT.format(text=text[:MAX_CHARS])
    out = llm.complete_json(prompt, SCHEMA, pdf=pdf)
    items = out.get("pledges") if isinstance(out, dict) else out
    if not isinstance(items, list):
        raise llm.LLMError(f"pledges 배열이 아닙니다: {str(out)[:200]}")
    clean = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = (it.get("title") or "").strip()
        if not title:
            continue
        clean.append({
            "title": title[:300],
            "body": (it.get("body") or "").strip() or None,
            "category": (it.get("category") or "기타").strip()[:40],
        })
    return clean


def run(conn, sg_id: str, limit: int | None, redo: bool, empty: bool = False) -> None:
    with conn.cursor() as cur:
        cur.execute(
            # raw_text 가 '' 인 공보는 이미지 스캔본이라 pdfplumber 가 한 글자도 못 읽은 것이다.
            # 예전에는 여기서 걸러버려 그런 사람은 영영 공약이 0건이었다 (35건).
            # 지금은 PDF 를 그대로 모델에 넘겨 읽는다. null 은 아직 내려받지도 않은 것이라 제외.
            "select id, member_code, raw_text, pdf_url from pledge_doc"
            " where election_id = %s and kind = '선거공보'"
            " and raw_text is not null"
            + ("" if redo or empty else " and parsed_at is null")
            # 한 번 돌렸는데 공약이 0건인 것만 다시. --redo 는 그 선거 전체를
            # 다시 돌려 한도를 통째로 태운다. 실패분은 보통 이미지 스캔본이라
            # PDF 직접 읽기 경로를 다시 태워보는 값이 있다.
            + (" and not exists (select 1 from pledge p where p.doc_id = pledge_doc.id)"
               if empty else "")
            + " order by id",
            (sg_id,),
        )
        docs = cur.fetchall()

    if limit:
        docs = docs[:limit]
    print(f"  대상 {len(docs)}건", file=sys.stderr)

    ok = fail = total = via_pdf = 0
    for i, (doc_id, mcode, text, pdf_url) in enumerate(docs, 1):
        pdf = None
        blank = not text.strip()
        if (blank or cid_ratio(text) > CID_LIMIT) and pdf_url:
            try:
                with bulletin.client() as c:
                    pdf = c.get(pdf_url).content
                via_pdf += 1
            except Exception as e:
                print(f"  [{i}] PDF 재다운로드 실패, 텍스트로 진행: {str(e)[:70]}",
                      file=sys.stderr)
        # 읽을 것이 없는데 모델을 부르면 지어낸 공약이 돌아온다. 한도만 태우고 해롭다.
        if blank and not pdf:
            fail += 1
            print(f"  [{i}] 텍스트도 PDF 도 없어 건너뜀 ({mcode})", file=sys.stderr)
            continue
        try:
            items = parse_one(text, pdf)
        except llm.QuotaExhausted as e:
            # 그날은 회복되지 않는다. 남은 문서를 헛돌리지 않고 멈춘다.
            # parsed_at 이 null 로 남아 다음 실행이 여기서 이어받는다.
            print(f"\n  중단: {e}", file=sys.stderr)
            print(f"  {len(docs) - i + 1}건이 남았습니다. 한도 회복 후 같은 명령을"
                  " 다시 실행하면 남은 것만 처리합니다.", file=sys.stderr)
            break
        except llm.LLMError as e:
            fail += 1
            print(f"  [{i}/{len(docs)}] {mcode} 실패: {str(e)[:150]}", file=sys.stderr)
            continue

        with conn.cursor() as cur:
            # 이 문서에서 나온 공약만 갈아끼운다. 선거공약 API 로 들어온 대표공약은
            # doc_id 가 달라서 건드리지 않는다.
            cur.execute("delete from pledge where doc_id = %s", (doc_id,))
            cur.executemany(
                "insert into pledge (doc_id, member_code, election_id, order_no,"
                " title, body, category, source)"
                " values (%s,%s,%s,%s,%s,%s,%s,'선거공보')",
                [(doc_id, mcode, sg_id, n, it["title"], it["body"], it["category"])
                 for n, it in enumerate(items, 1)],
            )
            cur.execute("update pledge_doc set parsed_at = now() where id = %s", (doc_id,))
        conn.commit()
        ok += 1
        total += len(items)
        if i % 10 == 0 or i == len(docs):
            print(f"  [{i}/{len(docs)}] 성공 {ok} 실패 {fail} 공약 {total}건",
                  file=sys.stderr)

    print(f"[parse] {sg_id}: 문서 {ok}건에서 공약 {total}건"
          f" (실패 {fail}, PDF 직접읽기 {via_pdf})", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sg", required=True)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--empty", action="store_true",
                   help="공약이 0건으로 남은 공보만 다시 (실패분 재시도)")
    p.add_argument("--redo", action="store_true")
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        run(conn, a.sg, a.limit, a.redo, a.empty)


if __name__ == "__main__":
    main()

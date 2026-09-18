#!/usr/bin/env python3
"""선거공보 텍스트 → 공약 목록.

선거공보 PDF 는 다단 편집이라 텍스트 추출본의 줄 순서가 뒤엉킨다. 규칙 기반 파싱은
포기하고 LLM 에 맡긴다. 대신 지어내지 못하도록 스키마를 강제하고, 원문에 없는 내용은
넣지 말라고 명시한다.

사용:
    python parse_pledges.py --sg 20240410 --limit 3     # 먼저 소량으로 품질 확인
    python parse_pledges.py --sg 20240410               # 전체
    python parse_pledges.py --sg 20240410 --redo        # 이미 한 것도 다시

환경변수: DATABASE_URL + llm.py 가 쓰는 것 (기본 GEMINI_API_KEY)
"""
from __future__ import annotations

import argparse
import os
import sys

import psycopg

import llm

# 선거공보는 공약 외에 학력·경력·재산·병역 신고내역이 절반을 차지한다.
# 그래도 통째로 넣는다. 잘라내려다 공약을 날리는 쪽이 더 나쁘다.
MAX_CHARS = 60_000

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


def parse_one(text: str) -> list[dict]:
    out = llm.complete_json(PROMPT.format(text=text[:MAX_CHARS]), SCHEMA)
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


def run(conn, sg_id: str, limit: int | None, redo: bool) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "select id, member_code, raw_text from pledge_doc"
            " where election_id = %s and raw_text is not null and raw_text <> ''"
            + ("" if redo else " and parsed_at is null")
            + " order by id",
            (sg_id,),
        )
        docs = cur.fetchall()

    if limit:
        docs = docs[:limit]
    print(f"  대상 {len(docs)}건", file=sys.stderr)

    ok = fail = total = 0
    for i, (doc_id, mcode, text) in enumerate(docs, 1):
        try:
            items = parse_one(text)
        except llm.LLMError as e:
            fail += 1
            print(f"  [{i}/{len(docs)}] {mcode} 실패: {str(e)[:120]}", file=sys.stderr)
            continue

        with conn.cursor() as cur:
            # 이 문서에서 나온 공약만 갈아끼운다. 선거공약 API 로 들어온 대표공약은
            # doc_id 가 달라서 건드리지 않는다.
            cur.execute("delete from pledge where doc_id = %s", (doc_id,))
            cur.executemany(
                "insert into pledge (doc_id, member_code, election_id, order_no,"
                " title, body, category) values (%s,%s,%s,%s,%s,%s,%s)",
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

    print(f"[parse] {sg_id}: 문서 {ok}건에서 공약 {total}건 (실패 {fail})", file=sys.stderr)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--sg", required=True)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--redo", action="store_true")
    a = p.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        sys.exit("DATABASE_URL 이 없습니다.")
    with psycopg.connect(dsn) as conn:
        run(conn, a.sg, a.limit, a.redo)


if __name__ == "__main__":
    main()

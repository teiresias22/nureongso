---
paths:
  - "collector/nec.py"
  - "collector/bulletin.py"
  - "collector/parse_pledges.py"
  - "collector/judge.py"
  - "collector/sample_review.py"
  - "web/src/app/rules/**"
  - "web/src/app/llms.txt/**"
---

# 공약·이행 판정

- 공약 API 는 선거공약서 제출 대상(대통령·시도지사·구시군의장·교육감)만 준다. 국회의원·지방의원은 선거공보 PDF → `bulletin.py`/`parse_pledges.py`.
- 공보 텍스트가 `(cid:NNNN)` 으로 깨지면 PDF 원본을 모델에 넘긴다.
- 판정 흐름: `classify`(확인 수단: 입법·조례제도·예산사업…) → `match`/`match_ordin`/`match_bid`(근거 대조) → `decide`(규칙표).
  결과는 완료·진행·미착수·**판단불가**. 근거 없는 공약은 판단불가 — 미이행이 아니다.
- 판정은 LLM 결과가 아니라 **공개된 규칙표**로 한다. 규칙을 바꾸면 `/rules` 페이지의 번호·문구도 같이 고친다.
- 자동 판정인지 사람 검수를 거쳤는지를 항상 함께 표시한다. 외부 기관 이행 등급은 싣지 않는다.
- judge 의 직접 SQL 도 `is distinct from` 조건을 단다(Disk IO).
- `sg_typecode`: 1 대통령, 2 국회의원, 3 시도지사, 4 구시군의장, 5 시도의원, 6 구시군의원, 7~9 비례, 10 교육의원, 11 교육감. `sg_id` 는 선거일 YYYYMMDD.

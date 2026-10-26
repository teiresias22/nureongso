"""judge.py 의 정규화·구절 찾기·버전 해시·판 이름. 네트워크·DB 없이 돈다."""
import judge

# 실측 모양: 열린국회정보 법안명 + 제안이유(BPMBILLSUMMARY) 원문. 줄바꿈·전각 공백이 섞여 온다.
NAME = "주차장법 일부개정법률안(홍길동의원 등 10인)"
SUMMARY = ("제안이유 및 주요내용\n\n　현행법은 노외주차장의 설치에 관한 사항을 정하고 있으나,"
           "\n지방자치단체가 공영주차장 확보 계획을 수립하도록 하는 규정이 없어 주차난이 심화되고 있음.")


def test_norm():
    # 호환 한자(李 U+F9E1 — ingest.people_of 의 함정)·전각 공백·널 바이트·줄바꿈을 편다.
    assert judge.norm("李　達坤\x00 의원\n\n안") == "李 達坤 의원 안"
    assert judge.norm("李") == "李"
    assert judge.norm("  ") == ""


def test_locate():
    text = judge.norm(NAME + "\n" + SUMMARY)
    span = judge.locate(text, "공영주차장 확보 계획을 수립")
    assert span and text[span[0]:span[1]] == "공영주차장 확보 계획을 수립"
    # 원문에서 줄이 바뀐 자리도 정규화 뒤에는 찾는다.
    assert judge.locate(text, "정하고 있으나,\n지방자치단체가") is not None
    # 모델이 줄임표로 잇거나 글자를 바꾼 구절은 원문 구절이 아니다.
    assert judge.locate(text, "노외주차장의 … 공영주차장") is None
    assert judge.locate(text, "공영 주차장 확보 계획") is None
    # 빈 구절 = 모델이 "해당 부분 없음" 이라 한 것.
    assert judge.locate(text, "") is None


def test_content_hash():
    a = judge.content_hash(NAME, {"proc_result": None, "proc_dt": None, "name": NAME})
    b = judge.content_hash(NAME, {"name": NAME, "proc_dt": None, "proc_result": None})
    c = judge.content_hash(NAME, {"name": NAME, "proc_dt": None, "proc_result": "대안반영폐기"})
    assert a == b, "facts 키 순서만 다른데 해시가 달라졌다"
    assert a != c, "처리결과가 바뀌었는데 해시가 같다"
    # 본문의 공백 모양만 다르면 같은 버전이다(재수집 때 줄바꿈이 바뀌는 일이 있다).
    assert judge.content_hash(NAME + "\n", {}) == judge.content_hash(NAME, {})


def test_versions():
    assert judge.PROMPT_VERSION["match"].startswith("match:") and len(judge.PROMPT_VERSION["match"]) == 14
    assert set(judge.PROMPT_VERSION) == {"match", "ordin", "bid", "quote"}
    # 프롬프트를 한 글자만 고쳐도 판이 바뀐다 — 손으로 올리지 않아 잊을 수 없다.
    assert judge.version("match", judge.MATCH_PROMPT + ".", judge.MATCH_SCHEMA) != judge.PROMPT_VERSION["match"]
    assert len(judge.RULE_VERSION) == 8


if __name__ == "__main__":
    for n, f in list(globals().items()):
        if n.startswith("test_"):
            f()
    print("ok")


# ---------------------------------------------------------------- 계약 시험 (판정 계획 T0.3, DB 없음)
import os
import re

from psycopg import _queries
from psycopg.adapt import Transformer

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "src")


def test_notes_have_labels():
    # 규칙표가 내는 note 는 모두 화면 문구가 있어야 한다. 없으면 db.ts noteText 가 코드 글자를 그대로 띄운다.
    case = judge.JUDGED_CTE.split("end as status,")[1].split("end as note")[0]   # note 를 내는 CASE
    notes = set(re.findall(r"(?:then|else) '([a-z0-9_]+)'", case))
    prefixed = set(re.findall(r"'([a-z_]+):' \|\|", case))
    db = open(os.path.join(WEB, "lib", "db.ts")).read()
    labels = set(re.findall(r"^\s+([a-z0-9_]+):", db.split("export const NOTE_LABEL")[1].split("};")[0], re.M))
    assert notes and notes - prefixed <= labels, notes - labels
    for p in prefixed:  # no_measure: · partial: 는 noteText 가 따로 푼다
        assert f'note.startsWith("{p}:")' in db, p


class _Cur:
    """execute 를 받아 psycopg 가 실제로 하는 매개변수 변환만 해 본다."""
    def __init__(self):
        self.q = _queries.PostgresQuery(Transformer())
        self.n = 0

    def execute(self, sql, params=None):
        self.q.convert(sql, params)  # '%' 를 '%%' 로 안 쓰면 여기서 ProgrammingError
        self.n += 1

    def fetchall(self): return []
    def fetchone(self): return (False,)
    def __enter__(self): return self
    def __exit__(self, *a): pass


class _Conn:
    def __init__(self): self.cur = _Cur()
    def cursor(self): return self.cur
    def rollback(self): pass


def test_sql_converts():
    cur = _Cur()
    cur.execute(judge.DECIDE_SQL, judge.PARAMS)
    judge.diff_rows(cur)
    conn = _Conn()
    judge.run_invariants(conn)
    assert conn.cur.n == 2 + len(judge.INVARIANTS)
    try:
        cur.execute("select 'reviewer:%' where 1 = %(a)s", {"a": 1})
    except Exception:
        pass
    else:
        raise AssertionError("psycopg 가 '%' 하나를 받아들였다 — 이 시험이 아무것도 막지 못한다")


def test_rule_version_listed():
    # 지금 판이 /rules '판정 기준 변경 기록'(#changes)에 있어야 한다. 빠뜨리면 배포하지 않는다(절차 R).
    rules = open(os.path.join(WEB, "app", "rules", "page.tsx")).read()
    assert f'ver: "{judge.RULE_VERSION}"' in rules, judge.RULE_VERSION


def test_gold_score():
    import sample_review as sr
    lo, hi = sr.wilson(10, 19)                      # 설계서 X18 표본: 10/19 → 32~73%
    assert round(lo, 2) == 0.32 and round(hi, 2) == 0.73, (lo, hi)
    assert sr.wilson(0, 0) == (0.0, 1.0)
    row = dict.fromkeys(sr.COLS, "")
    rows = [dict(row, layer="done", pledge_id="1", ev="bill:A", label="ok", scope="전부", enacted="예"),
            dict(row, layer="done", pledge_id="2", ev="ordin:B", label="wrong", scope="전부", enacted="예"),
            dict(row, layer="done", pledge_id="3", ev="bill:C")]                 # 아직 안 채움 — 세지 않는다
    out = "\n".join(sr.score_gold(rows))
    assert "근거 정밀도 bill: 1/1" in out and "근거 정밀도 ordin: 0/1" in out and "완료 정밀도(맞는 근거·전부·공포): 1/2" in out, out


def test_web_term_start():
    # 근거 줄의 '취임일 전 기록' 은 judge 와 같은 날짜로 단다(판정 계획 T0.3 (d)).
    src = open(os.path.join(WEB, "lib", "timeline.ts")).read()
    assert f'export const HEAD_TERM_START = "{judge.HEAD_TERM_START}";' in src


def test_self_contradicted():
    # 실측 근거 이유(4163·12186). 법안·조례 대조도 이런 연결을 버린다(판정 계획 T1.6).
    assert judge.self_contradicted("공약은 지역 사업이나 법안 성격 불일치")
    assert not judge.self_contradicted("공영주차장 확보 계획 수립을 의무화해 공약과 같은 일을 한다")


def test_notes_have_rule_rows():
    # note 마다 /rules 2번 표에 r-<note> 행이 있어야 한다(계약 시험 (c)). 사유에서 규칙으로 바로 갈 수 있게.
    case = judge.JUDGED_CTE.split("end as status,")[1].split("end as note")[0]
    notes = set(re.findall(r"(?:then|else) '([a-z0-9_]+)'", case)) | set(re.findall(r"'([a-z_]+):' \|\|", case))
    rules = open(os.path.join(WEB, "app", "rules", "page.tsx")).read()
    rows = set(re.findall(r'^  \["([a-z0-9_]+)", ', rules.split("const JUDGE_ROWS")[1].split("];")[0], re.M))
    assert notes == rows, (notes - rows, rows - notes)


def test_ordin_org():
    assert judge.ordin_org("구시군의장", "인천광역시", "서구") == "인천광역시 서해구"   # 2026-07-01 개칭
    assert judge.ordin_org("구시군의장", "대구광역시", "서구") == "대구광역시 서구"
    assert judge.ordin_org("구시군의장", "전라남도", "목포시") == "전남광주통합특별시 목포시"
    assert judge.ordin_org("교육감", "광주광역시", "") == "전남광주통합특별시교육청"


def test_same_project():
    """임기 첫해 발주의 이전 단계 공고(결정 J 표시). 같은 기관 안 다른 시설은 붙지 않는다."""
    sp = judge.same_project
    assert sp("용연저수지 수변 둘레길 조성 사업", "용연저수지 둘레길 조성사업 기본 및 실시설계 용역")
    assert sp("사천시 시니어친화형 국민체육센터 건립공사(건축)(총괄분)", "사천시 시니어친화형 국민체육센터 복합화사업 기본 및 실시설계 용역(설계공모)")
    assert sp("북삼읍 농촌중심지 활성화사업 사람in복합센터(건축)", "북삼읍 농촌중심지활성화사업 설계용역(제안공모)")
    assert not sp("고성읍 교동공영주차장 조성사업", "고성읍 남내공영주차장 조성사업 편입건물 철거공사")
    assert not sp("은평아이맘놀이터 불광1동점 조성공사", "은평아이맘놀이터 역촌동점(1호점)놀이공간 조성공사")
    assert not sp("수지근린공원 체육시설 정비사업", "서천지구 근린공원 체육시설 정비공사")
    assert not sp("2026년도 산불진화임도사업(포항 죽장 두마~죽장 두마)", "2025년도 산불진화임도사업(상주 외남 흔평~흔평) 실시설계용역")
    assert not sp("중구 청사 전기공사", "중구 청사 설계용역")   # 남는 낱말이 너무 짧으면 같다고 하지 않는다

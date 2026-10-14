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

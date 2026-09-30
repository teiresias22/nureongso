---
paths:
  - "collector/test_*.py"
---

# 테스트

- pytest 없다. `assert` 로 된 `test_*` 함수나 최상위 `assert`. 픽스처·프레임워크를 들이지 않는다.
- 네트워크·DB 없이 돈다. 입력은 **실측 원문 모양 그대로** 줄여 붙인다(숫자·띄어쓰기·한자·괄호 포함).
  함정을 고치면 그 원문 한 줄을 테스트에 더한다 — `박 정`, `李達坤`, `이수진(비)더불어민주당` 같은 것.
- 파서·이름 잇기·금액처럼 분기가 있는 곳만 테스트한다. 한 줄짜리는 안 한다.
- 실행(루트 `CLAUDE.md` 와 같은 명령):

```bash
cd collector && for f in test_*.py; do dotenvx run -q -- .venv/bin/python -c "import importlib;m=importlib.import_module('${f%.py}');[getattr(m,n)() for n in dir(m) if n.startswith('test_')]" || echo "FAIL $f"; done
```

  `python test_x.py` 는 `__main__` 이 없는 파일(`test_asset`·`test_extras`·`test_gwanbo`)에서 아무것도 돌리지 않는다.
- `test_ingest.py` 는 `ASSEMBLY_API_KEY` 가 있어야 해서 `dotenvx run` 을 거친다.

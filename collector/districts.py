"""국회의원 지역구가 어느 동으로 이뤄지는지 뽑아 web 에 넣는다.

유권자는 자기가 강남구에 산다는 건 알아도 갑·을·병이 어디서 갈리는지는 모른다.
선거구역표는 공직선거법 [별표 1] 에 있다. 법제처가 그 별표를 JSON 안에 **글자 표**
그대로 담아 줘서 HWP·PDF 를 뜯을 필요가 없다.

4년에 한 번(선거구 재획정) 바뀌는 값이라 테이블을 만들지 않는다. JSON 파일 하나로
두고, 재획정 때 이 스크립트를 다시 돌린다.

    python districts.py            # web/src/lib/districts.json 갱신

환경변수: DATABASE_URL, LAW_OC
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import psycopg

LAW_ID = "001725"  # 공직선거법
OUT = Path(__file__).resolve().parent.parent / "web/src/lib/districts.json"


def fetch() -> list[str]:
    p = dict(OC=os.getenv("LAW_OC") or "test", target="law", type="JSON", ID=LAW_ID)
    url = "https://www.law.go.kr/DRF/lawService.do?" + urllib.parse.urlencode(p)
    with urllib.request.urlopen(url, timeout=60) as r:
        d = json.loads(r.read())
    byl = d["법령"]["별표"]["별표단위"]
    byl = byl if isinstance(byl, list) else [byl]
    head = byl[0]["별표제목"]
    if "국회의원지역선거구" not in head:
        raise RuntimeError(f"별표 1 이 선거구구역표가 아닙니다: {head}")
    print(f"  {head}", file=sys.stderr)
    return [l for chunk in byl[0]["별표내용"] for l in chunk]


def clean(area: str) -> str:
    # 원문의 가운뎃점(ㆍ)이 '?' 로 깨져 온다. '금호2?3가동' → '금호2·3가동'.
    # 줄이 바뀐 자리에서 ',' 뒤 공백도 사라져 있어 쉼표로 다시 갈라 붙인다.
    return ", ".join(x.strip() for x in area.replace("?", "·").split(",") if x.strip())


def parse(lines: list[str]) -> dict[tuple[str, str], str]:
    """글자 표를 (시도, 선거구명) → 선거구역 으로.

    칸 너비가 좁아 선거구명도 선거구역도 줄을 넘긴다. '선거구' 로 끝나야 이름이
    다 온 것이라, 그 전까지는 앞 행에 이어 붙인다."""
    rows: list[list[str]] = []
    sd = None
    for line in lines:
        if not line.startswith("│"):
            continue
        cells = [c.strip() for c in line.strip("│").split("│")]
        if len(cells) == 1:  # '서울특별시(지역구 : 48)'
            m = re.match(r"^(.+?)\(지역구", cells[0])
            if m:
                sd = m.group(1).strip()
            continue
        # 표 머리글('선 거 구 명')은 첫 시도보다 앞에 온다.
        if len(cells) != 2 or sd is None:
            continue
        name, area = cells
        if name and (not rows or rows[-1][1].endswith("선거구")):
            rows.append([sd, name, area])
        elif rows:
            rows[-1][1] += name
            rows[-1][2] += area
    return {(sd, n.removesuffix("선거구")): clean(a) for sd, n, a in rows}


# 2026년 지방선거에서 광주·전남이 합쳐 법은 새 이름을 쓰는데, 2024년에 뽑힌
# 국회의원의 선관위 기록은 옛 이름 그대로다. 전북도 2024년엔 '전라북도'였다.
SD_ALIAS = {
    "광주광역시": "전남광주통합특별시",
    "전라남도": "전남광주통합특별시",
    "전라북도": "전북특별자치도",
}


def main() -> None:
    area_of = parse(fetch())
    print(f"  선거구 {len(area_of)}곳", file=sys.stderr)

    # 화면에서는 member.district('서울 송파구병') 한 줄만 들고 있다. 여기서 미리
    # 그 문자열로 맞춰 두면 화면은 map 조회 한 번이면 된다.
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute(
            "select distinct on (m.code) m.district, c.sd_name, c.district"
            " from member m join candidacy c"
            "   on c.member_code = m.code and c.elected and c.office = '국회의원'"
            " where m.is_incumbent and m.office = '국회의원'"
            "   and c.district <> '비례대표'"
            " order by m.code, c.election_id desc")
        rows = cur.fetchall()

    out: dict[str, str] = {}
    missed: list[tuple[str, str]] = []
    for key, sd, name in rows:
        # 지금 지역구인 것만. 비례대표로 들어온 의원도 예전 지역구 출마 기록이 있어,
        # 그대로 쓰면 비례 의원 화면에 옛 지역구의 동이 붙는다.
        if not key.endswith(name):
            continue
        area = area_of.get((SD_ALIAS.get(sd, sd), name))
        if area is None:
            missed.append((sd, name))
            continue
        # '종로구 일원' 처럼 구 전체가 한 선거구면 나눌 게 없어 적지 않는다.
        if area.endswith("일원") and "," not in area:
            continue
        out[key] = area

    # 현직만 본다. 지난 대의 선거구는 현행 구역표에 없고, 옛 member.district 는
    # 시도 접두어가 없어('강남구갑') 구청장 관할과 키가 겹친다.
    if missed:
        print(f"  ! 구역표에 없는 지역구 {len(missed)}곳: {missed[:5]}", file=sys.stderr)

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    print(f"[districts] {len(out)}곳 → {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()

#!/bin/sh
# 선거공보 수집 → 공약 파싱을 순서대로 돌린다.
# 전부 이어받기(resume)가 되므로 중간에 끊겨도 다시 실행하면 남은 것만 처리한다.
#
#   sh run_pledges.sh          # 전체
#   sh run_pledges.sh fetch    # 수집만
#   sh run_pledges.sh parse    # 파싱만
set -e
cd "$(dirname "$0")"
PY=.venv/bin/python
STEP="${1:-all}"

if [ "$STEP" = "all" ] || [ "$STEP" = "fetch" ]; then
  echo "=== 선거공보 수집"
  # 22대 총선: 지역구만 (비례대표는 정당이 공보를 내므로 개인 공약이 없다)
  $PY bulletin.py fetch --sg 20240410 --type 2
  # 제9회 지방선거: 시도지사 / 교육감 / 기초단체장
  for t in 3 11 4; do
    $PY bulletin.py fetch --sg 20260603 --type "$t"
  done
fi

if [ "$STEP" = "all" ] || [ "$STEP" = "parse" ]; then
  echo "=== 공약 파싱"
  $PY parse_pledges.py --sg 20240410
  $PY parse_pledges.py --sg 20260603
  $PY ingest.py refresh
fi
echo "=== 완료"

#!/bin/bash
# PreToolUse 가드 — exit 2 = 차단, stderr 가 Claude 에게 전달된다.
in=$(cat)
tool=$(jq -r '.tool_name' <<<"$in")
path=$(jq -r '.tool_input.file_path // empty' <<<"$in")
cmd=$(jq -r '.tool_input.command // .tool_input.query // .tool_input.sql // empty' <<<"$in")

block() { echo "차단: $1" >&2; exit 2; }

# dotenvx 개인키. 이게 새면 커밋된 암호문 .env 가 전부 평문이 된다.
[[ "$path" == *.env.keys ]] && block ".env.keys 는 읽거나 쓰지 않는다."
grep -q '\.env\.keys' <<<"$cmd" && block ".env.keys 는 읽거나 쓰지 않는다."

# .env 는 제자리 암호화돼 있다. 직접 쓰면 평문이 섞여 커밋된다.
if [[ "$tool" =~ ^(Edit|Write)$ && "$(basename "$path")" == .env* && "$path" != *.env.example ]]; then
  block "$path 는 dotenvx 암호문이다. 'dotenvx set KEY 값' 으로 바꿀 것."
fi

# 병렬 세션: 전체 add 는 남의 미커밋 작업을 쓸어 담는다.
grep -Eq 'git +add +(-A|--all|\.)( |$|;|&)|git +commit +[^|;&]*-a[a-z]* ' <<<"$cmd" \
  && block "git add -A / . / commit -a 금지. 파일을 명시해서 add 할 것."

grep -Eq 'git +push .*(-f|--force)( |$)' <<<"$cmd" && block "master 강제 push 금지."

# 배포 브레이크: master push = Vercel 프로덕션 배포이고, 배포마다 ISR 캐시가 새로 시작돼
# 법안 2만 쪽을 크롤러가 여는 대로 다시 그린다. 하루 18번 배포하던 때 무료 ISR 쓰기를 넘겼다(2026-10).
# 최근 24시간 프로덕션 배포(GitHub deployments)가 한도 이상이면 막는다. gh 가 실패하면 막지 않는다.
# 사용자가 이번 배포를 명시적으로 허락했을 때만 명령 앞에 DEPLOY_BRAKE_OK=1 을 붙여 통과시킨다.
DEPLOY_LIMIT=3
if grep -Eq 'git( +-C +[^ ]+)? +push' <<<"$cmd" && ! grep -q 'DEPLOY_BRAKE_OK=1' <<<"$cmd"; then
  to_master=0
  grep -Eq '(^|[ :/])master( |$|;|&)' <<<"$cmd" && to_master=1
  # 인자 없는 push 는 지금 브랜치로 간다.
  grep -Eq 'git( +-C +[^ ]+)? +push( +origin)? *($|;|&)' <<<"$cmd" \
    && [[ "$(git -C "${CLAUDE_PROJECT_DIR:-.}" branch --show-current 2>/dev/null)" == master ]] && to_master=1
  if (( to_master )); then
    recent=$(gh api 'repos/teiresias22/nureongso/deployments?environment=Production&per_page=30' \
      --jq '[.[] | select((.created_at | fromdateiso8601) > (now - 86400)) | .created_at] | join(", ")' 2>/dev/null) || recent=""
    n=$(tr ',' '\n' <<<"$recent" | grep -c .)
    (( n >= DEPLOY_LIMIT )) && block "최근 24시간 프로덕션 배포가 ${n}번이다(한도 ${DEPLOY_LIMIT}, UTC: ${recent}).
배포마다 ISR 캐시가 비워져 Vercel 무료 한도를 먹는다. 커밋은 master 에 모아 두고 나중에 한 번에 push 할 것.
지금 꼭 배포해야 하면 사용자에게 이유와 함께 물어보고, 허락받은 경우에만 명령 앞에 DEPLOY_BRAKE_OK=1 을 붙일 것."
  fi
fi

# 운영 DB 하나뿐(스테이징 없음). 파괴적 SQL 은 사용자가 직접.
if [[ "$tool" == mcp__* ]] || grep -Eq 'psql|psycopg|execute' <<<"$cmd"; then
  grep -Eiq 'drop +(table|schema|database)|truncate ' <<<"$cmd" \
    && block "운영 DB 에 drop/truncate. 사용자에게 확인받고 직접 실행하게 할 것."
fi
exit 0

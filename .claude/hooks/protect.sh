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

# 운영 DB 하나뿐(스테이징 없음). 파괴적 SQL 은 사용자가 직접.
if [[ "$tool" == mcp__* ]] || grep -Eq 'psql|psycopg|execute' <<<"$cmd"; then
  grep -Eiq 'drop +(table|schema|database)|truncate ' <<<"$cmd" \
    && block "운영 DB 에 drop/truncate. 사용자에게 확인받고 직접 실행하게 할 것."
fi
exit 0

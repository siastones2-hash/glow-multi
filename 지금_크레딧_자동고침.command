#!/bin/zsh
set -e
cd "$(dirname "$0")"
NODE="/Applications/Cursor 2.app/Contents/Resources/app/resources/helpers/node"
[ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null)" || NODE="/usr/bin/node"

echo ""
echo "  ═══ GLOW 크레딧 자동 고침 ═══"
echo ""

# 1) 배포 푸시 시도 (성공하면 서버 재시작 때 DB도 자동 정리됨)
if [[ -x "./배포_푸시.command" ]]; then
  echo "  [1] GitHub 푸시 시도 중..."
  if ./배포_푸시.command </dev/null 2>/dev/null | grep -q "푸시 완료"; then
    echo "  → 푸시 OK. Render 배포 후 3분 뒤 새로고침 (SQL 불필요)"
    read "?엔터로 닫기... "
    exit 0
  fi
  echo "  → 푸시는 건너뜀 (아래 DB 직접 수정 진행)"
  echo ""
fi

# 2) DATABASE_URL — 환경변수 또는 붙여넣기 1번
if [[ -z "$DATABASE_URL" ]]; then
  if [[ -f "$HOME/glow-multi/.env" ]]; then
    export $(grep -v '^#' "$HOME/glow-multi/.env" | xargs) 2>/dev/null || true
  fi
  if [[ -f "./.env" ]]; then
    export $(grep -v '^#' "./.env" | xargs) 2>/dev/null || true
  fi
fi

if [[ -z "$DATABASE_URL" ]]; then
  echo "  Render에서 DB 주소 한 번만 붙여넣으면 됩니다."
  echo "  dashboard.render.com → PostgreSQL → Connect → External Database URL"
  echo ""
  DB_URL=$(osascript 2>/dev/null <<'APPLESCRIPT' || true
set d to display dialog "External Database URL 전체를 붙여넣고 OK 누르세요." & return & return & "(Render → DB → Connect → External URL)" default answer "" with title "GLOW 크레딧 고침" buttons {"취소", "실행"} default button "실행"
if button returned of d is "실행" then
  return text returned of d
else
  return ""
end if
APPLESCRIPT
)
  if [[ -z "$DB_URL" ]]; then
    echo "  취소됨."
    read "?엔터..."
    exit 1
  fi
  export DATABASE_URL="$DB_URL"
fi

# pg 모듈 (glow-multi 폴더에 설치)
if [[ ! -d "./glow-multi/node_modules/pg" ]]; then
  echo "  [2] 패키지 설치 중 (최초 1회)..."
  mkdir -p "./glow-multi"
  (cd "./glow-multi" && "$NODE" -e "require('child_process').execSync('npm install pg --no-save',{stdio:'inherit'})" 2>/dev/null) || \
  (cd "./glow-multi" && npm install pg --no-save 2>/dev/null) || true
fi

export NODE_PATH="./glow-multi/node_modules:./node_modules"
echo "  [3] DB 크레딧 정리 실행..."
"$NODE" "./fix-credits-run.js"

read "?엔터로 닫기... "

#!/bin/bash
# 총판(본사) 미리보기 1탭
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
DIR_DEMO="$(cd "$(dirname "$0")/demo" && pwd)"
PORT=8765
LOG="/tmp/supershasha-demo.log"
URL="http://127.0.0.1:${PORT}/index.html?tenant=master"

cd "$DIR_DEMO" || { echo "demo 폴더 없음"; read -n1; exit 1; }

if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[슈퍼샤샤] 서버 시작..."
  nohup python3 -m http.server "$PORT" >>"$LOG" 2>&1 &
fi

for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sf "http://127.0.0.1:${PORT}/index.html" >/dev/null 2>&1 && break
  sleep 0.4
done

open_new_window "$URL"
echo "열림: $URL  (master / master1234)"
sleep 2

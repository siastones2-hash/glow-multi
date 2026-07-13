#!/bin/bash
# 본사(숨김) + 총판 미리보기 2탭
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
DIR_DEMO="$(cd "$(dirname "$0")/demo" && pwd)"
PORT=8765
LOG="/tmp/supershasha-demo.log"
BASE="http://127.0.0.1:${PORT}/index.html"

cd "$DIR_DEMO" || { echo "demo 폴더 없음: $DIR_DEMO"; read -n1; exit 1; }

if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[슈퍼샤샤] 서버 시작 중... (포트 $PORT)"
  nohup python3 -m http.server "$PORT" >>"$LOG" 2>&1 &
  echo $! >/tmp/supershasha-demo.pid
fi

OK=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -sf "${BASE}" >/dev/null 2>&1; then OK=1; break; fi
  sleep 0.4
done

if [ "$OK" != "1" ]; then
  echo "[!] 서버가 안 떴습니다. 로그: $LOG"
  tail -5 "$LOG" 2>/dev/null
  osascript -e 'display alert "슈퍼샤샤" message "미리보기 서버 시작 실패.\n터미널 메시지를 확인하세요." as critical' 2>/dev/null
  read -n1
  exit 1
fi

echo "[OK] 브라우저 새 창 2개 열기..."
open_new_window "${BASE}?tenant=sh4-op-internal"
sleep 0.4
open_new_window "${BASE}?tenant=master"
echo ""
echo "  슈퍼시아: ${BASE}?tenant=sh4-op-internal  (leestones / 1234)"
echo "  본사:     ${BASE}?tenant=master           (master / master1234)"
echo ""
sleep 2

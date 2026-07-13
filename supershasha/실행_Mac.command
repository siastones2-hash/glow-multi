#!/bin/bash
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
PORT="${PORT:-3000}"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"
NODE="$DIR/.node-runtime/bin/node"
NPM="$DIR/.node-runtime/bin/npm"
if [ ! -x "$NODE" ]; then
  command -v node >/dev/null 2>&1 || { echo "[!] Node.js 없음. .node-runtime 설치 또는 https://nodejs.org LTS"; read -n1; exit 1; }
  NODE=node
  NPM=npm
fi

echo "=== npm install (처음 1회) ==="
"$NPM" install -q

echo "=== 슈퍼샤샤 서버 시작 (백그라운드) :$PORT ==="
if supershasha_launchd_loaded; then
  echo "  (상시 실행 등록됨 — launchd가 관리)"
  launchctl kickstart -k "gui/$(id -u)/com.supershasha.server" 2>/dev/null || true
else
  echo "  (이번만 백그라운드 — 영구 유지: 서버-항상켜기.command)"
fi

if ! supershasha_ensure; then
  osascript -e 'display alert "슈퍼샤샤" message "서버 시작 실패.\n/tmp/supershasha-srv.log 확인" as critical' 2>/dev/null
  read -n1
  exit 1
fi

(
  open_new_window "http://127.0.0.1:${PORT}/?tenant=sh4-op-internal"
  sleep 0.5
  open_new_window "http://127.0.0.1:${PORT}/?tenant=master"
  sleep 0.5
  open_new_window "http://127.0.0.1:${PORT}/?tenant=nine"
) &

echo ""
echo "  슈퍼시아:   http://127.0.0.1:${PORT}/?tenant=sh4-op-internal  (leestones / 1234)"
echo "  본사:       http://127.0.0.1:${PORT}/?tenant=master  (master / master1234)"
echo "  나인스토리: http://127.0.0.1:${PORT}/?tenant=nine  (nineadmin / nine1234)"
echo ""
echo "  ✅ 서버 백그라운드 실행 중 — 이 창 닫아도 됩니다."
echo "  🔒 Mac 재부팅 후에도 유지: 서버-항상켜기.command (1회만)"
echo ""
sleep 2

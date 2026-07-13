#!/bin/bash
# 슈퍼샤샤 — 서버 켜기 + 슈퍼샤샤·본사·나인 새 창 3개
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"
PORT="${PORT:-3000}"

if ! supershasha_health; then
  echo "서버 시작 중..."
  supershasha_ensure || {
    echo "[!] 서버 실패. 로그: /tmp/supershasha-srv.log"
    tail -5 /tmp/supershasha-srv.log 2>/dev/null
    read -n1
    exit 1
  }
fi

echo "브라우저 새 창 3개 열기..."
open_new_window "http://127.0.0.1:${PORT}/?tenant=sh4-op-internal"
sleep 0.7
open_new_window "http://127.0.0.1:${PORT}/?tenant=master"
sleep 0.7
open_new_window "http://127.0.0.1:${PORT}/?tenant=nine"

echo ""
echo "  슈퍼샤샤:   ?tenant=sh4-op-internal  (leestones / 1234)"
echo "  본사:       ?tenant=master           (master / master1234)"
echo "  나인스토리: ?tenant=nine             (nineadmin / nine1234)"
echo ""
echo "서버는 백그라운드에서 실행 중입니다."
sleep 2

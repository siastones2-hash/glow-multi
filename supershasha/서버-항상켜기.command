#!/bin/bash
# 슈퍼샤샤 — Mac 로그인 시 자동 시작 + 죽으면 재시작 (GLOW Render처럼 끊기지 않게)
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"

echo "=== 슈퍼샤샤 서버 상시 실행 등록 ==="
if supershasha_install_launchd; then
  echo ""
  echo "  ✅ 서버 항상 켜짐 (포트 ${PORT})"
  echo "  ─────────────────────────────"
  echo "  · Mac 켜지면 자동 시작"
  echo "  · 서버 죽으면 자동 재시작"
  echo "  · 터미널/Cursor 창 닫아도 유지"
  echo ""
  echo "  슈퍼샤샤: http://127.0.0.1:${PORT}/?tenant=sh4-op-internal"
  echo "  본사:     http://127.0.0.1:${PORT}/?tenant=master"
  echo ""
  echo "  끄려면: 서버-끄기.command"
  echo "  로그:   /tmp/supershasha-srv.log"
else
  echo "[!] 등록 실패"
fi
echo ""
read -p "Enter 키로 닫기…" x

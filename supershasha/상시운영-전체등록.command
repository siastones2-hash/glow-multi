#!/bin/bash
# 슈퍼샤샤 — 서버 + 터널 상시 실행 (Mac 재부팅·프로세스 종료 시 자동 복구)
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"

echo "=== 슈퍼샤샤 상시 운영 등록 (서버 + 공개 터널) ==="
if supershasha_install_all_launchd; then
  PUB="$(cat "$DIR/data/public-base.txt" 2>/dev/null || true)"
  echo ""
  echo "  ✅ 서버 + 터널 항상 켜짐 (포트 ${PORT})"
  echo "  ─────────────────────────────"
  echo "  · Mac 로그인 시 자동 시작"
  echo "  · 죽으면 자동 재시작 (터널도 재연결)"
  echo "  · Cursor/터미널 닫아도 유지"
  echo ""
  echo "  로컬 본사: http://127.0.0.1:${PORT}/?tenant=master"
  if [[ -n "$PUB" ]]; then
    echo "  공개 본사: ${PUB}/?tenant=master"
  fi
  echo ""
  echo "  끄려면: 상시운영-끄기.command"
  echo "  서버 로그: /tmp/supershasha-srv.log"
  echo "  터널 로그: /tmp/supershasha-tunnel.log"
else
  echo "[!] 등록 실패"
fi
echo ""
read -p "Enter 키로 닫기…" x

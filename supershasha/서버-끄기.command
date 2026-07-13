#!/bin/bash
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"

echo "=== 슈퍼샤샤 서버 중지 ==="
supershasha_uninstall_launchd
echo ""
echo "  ✅ 상시 실행 해제 · 서버 중지됨"
echo ""
read -p "Enter 키로 닫기…" x

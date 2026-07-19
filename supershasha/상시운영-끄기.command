#!/bin/bash
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"

echo "=== 슈퍼샤샤 상시 운영 해제 ==="
supershasha_uninstall_all_launchd
echo ""
echo "  ✅ 서버 + 터널 상시 실행 해제됨"
echo ""
read -p "Enter 키로 닫기…" x

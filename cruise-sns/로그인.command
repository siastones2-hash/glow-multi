#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo " 서울크루즈 축제 · @glowsiax / @siastreet"
echo " 이미 로그인돼 있으면 창만 확인하면 됩니다"
echo "=========================================="
if [ -d "../ig-auto/data/browser-profile" ]; then
  echo "기존 로그인을 그대로 씁니다."
fi
export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
/usr/bin/python3 scripts/post.py --login --headed
echo
read -n 1 -p "엔터로 닫기..."

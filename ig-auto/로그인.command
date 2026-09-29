#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo " 3D어라운드 자동발행 로그인"
echo "=========================================="
echo "Cursor 브라우저 세션 → 자동발행 프로필로 복사"
echo " (인스타 @glowsiax + 스레드 @siastreet)"
echo "=========================================="
/usr/bin/python3 scripts/sync_login_from_cursor.py
rc=$?
if [ $rc -ne 0 ]; then
  echo
  echo "자동 복사 실패 → 수동 로그인 창을 엽니다."
  echo "1) 인스타 @glowsiax 로그인"
  echo "2) Threads @siastreet 확인"
  /usr/bin/python3 scripts/post_playwright.py --login --headed
fi
echo
read -n 1 -p "엔터로 닫기..."

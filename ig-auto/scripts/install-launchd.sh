#!/bin/bash
# GLOW @glowsiax 인스타 자동발행 launchd 등록 (10분마다 체크 → 하루 2회, 09–22시 균등)
set -euo pipefail
ROOT="/Users/apple/glow-multi/ig-auto"
PLIST_SRC="$ROOT/scripts/com.glow.ig-auto.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.glow.ig-auto.plist"
LABEL="com.glow.ig-auto"

if [ -f "$ROOT/STOPPED" ]; then
  echo "중지됨. @glowsiax 는 이제 서울크루즈 축제(cruise-sns)만 올립니다."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data" "$ROOT/out"
chmod +x "$ROOT/scripts/post_once.py" "$ROOT/scripts/scheduler.py" "$ROOT/오늘-올리기.command" "$ROOT/자동발행-켜기.command" "$ROOT/자동발행-끄기.command" 2>/dev/null || true

cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || true

echo "등록됨: $LABEL (10분마다, 하루 2회 · 09–22시 균등)"
echo "수동 1회: $ROOT/오늘-올리기.command"
echo "로그: $ROOT/data/run.log"
echo "쿠키: $ROOT/data/ig-cookies.json 필요"

#!/bin/bash
# 매일 자동 발행 (launchd) — Mac 켜져 있을 때 .env 시각에 1개
cd "$(dirname "$0")"
PLIST="$HOME/Library/LaunchAgents/com.supersia.threads-auto.plist"
SRC="$(pwd)/scripts/com.supersia.threads-auto.plist"

mkdir -p "$HOME/Library/LaunchAgents"
cp "$SRC" "$PLIST"
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"

H=$(grep PUBLISH_HOUR .env 2>/dev/null | cut -d= -f2)
M=$(grep PUBLISH_MINUTE .env 2>/dev/null | cut -d= -f2)
H=${H:-9}
M=${M:-0}

MODE=$(grep CONTENT_MODE .env 2>/dev/null | cut -d= -f2)
MODE=${MODE:-trend}

echo ""
echo "  ✅ 자동 발행 켜짐"
echo "  ─────────────────"
if [ "$MODE" = "diary" ]; then
  echo "  모드: 📓 일기 (큐 시각에 3~5개/일)"
  echo "  먼저: 일기-큐채우기.command"
else
  echo "  매일 ${H}:$(printf '%02d' "$M") (KST)에 글 1개 자동 업로드"
fi
echo "  Mac이 켜져 있어야 합니다."
echo ""
echo "  끄려면: 자동발행-끄기.command"
echo ""
read -p "Enter 키로 닫기…" x

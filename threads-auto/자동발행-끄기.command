#!/bin/bash
cd "$(dirname "$0")"
PLIST="$HOME/Library/LaunchAgents/com.supersia.threads-auto.plist"

launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"

echo ""
echo "  ⏸  자동 발행 꺼짐"
echo ""
read -p "Enter 키로 닫기…" x

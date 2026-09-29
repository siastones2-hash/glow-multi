#!/bin/bash
LABEL="com.glow.ig-auto"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "GLOW 인스타·스레드 자동발행 꺼짐: $LABEL"
echo
read -n 1 -p "엔터로 닫기..."

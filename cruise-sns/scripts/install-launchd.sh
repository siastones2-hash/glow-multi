#!/bin/bash
set -euo pipefail
ROOT="/Users/apple/glow-multi/cruise-sns"
PLIST_SRC="$ROOT/scripts/com.glow.cruise-sns.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.glow.cruise-sns.plist"
LABEL="com.glow.cruise-sns"

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data" "$ROOT/out"
chmod +x "$ROOT/scripts/post.py" "$ROOT/scripts/scheduler.py" \
  "$ROOT/오늘-올리기.command" "$ROOT/로그인.command" \
  "$ROOT/자동발행-켜기.command" "$ROOT/자동발행-끄기.command" 2>/dev/null || true

# config에서 자동을 켠 뒤에만 launchd 등록
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/Users/apple/glow-multi/cruise-sns/config.json")
cfg = json.loads(p.read_text(encoding="utf-8"))
if not cfg.get("auto_enabled"):
    raise SystemExit("config.json 의 auto_enabled 를 true 로 바꾼 뒤 다시 켜세요.")
PY

cp "$PLIST_SRC" "$PLIST_DST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
echo "등록됨: $LABEL"
echo "@glowsiax / @siastreet 에 축제 콘텐츠만 올립니다. 3D ig-auto 는 끄세요."

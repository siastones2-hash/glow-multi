#!/bin/bash
LABEL="com.glow.cruise-sns"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
python3 - <<'PY'
import json
from pathlib import Path
p = Path("/Users/apple/glow-multi/cruise-sns/config.json")
cfg = json.loads(p.read_text(encoding="utf-8"))
cfg["auto_enabled"] = False
p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("auto_enabled=false")
PY
echo "축제 자동발행 끔"
read -n 1 -p "엔터로 닫기..."

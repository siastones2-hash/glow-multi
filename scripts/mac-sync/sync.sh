#!/bin/zsh
set -e
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
SHARED="$ICLOUD/맥-공유설정"
GLOW="$HOME/glow-multi"
MODE="${1:-pull}"

echo ""
echo "  ═══ 맥북 ↔ 맥 스튜디오 동기화 ($MODE) ═══"
echo ""

mkdir -p "$SHARED/cursor" "$ICLOUD/인입"

# 1) Cursor/MCP 설정 (양쪽 맥 동일)
bash "$HOME/Scripts/mac-sync/install-cursor-config.sh"
cp "$HOME/.cursor/mcp.json" "$SHARED/cursor/mcp.json" 2>/dev/null || true
cp "$HOME/.cursor/permissions.json" "$SHARED/cursor/permissions.json" 2>/dev/null || true
echo "  [1] Cursor 설정 OK"

# 2) 파일 자동정리
if [[ -x "$HOME/Scripts/file-organizer/setup.command" ]]; then
  "$HOME/Scripts/file-organizer/setup.command" </dev/null 2>&1 | grep -E '감시|인입|완료' || true
fi
echo "  [2] 파일 정리기 OK"

# 3) glow-multi Git
if [[ -d "$GLOW/.git" ]]; then
  cd "$GLOW"
  if [[ "$MODE" == "push" ]]; then
    git add -A 2>/dev/null || true
    if git diff --cached --quiet 2>/dev/null; then
      echo "  [3] Git: 저장할 변경 없음"
    else
      git commit -m "sync: $(hostname -s) $(date '+%Y-%m-%d %H:%M')" 2>/dev/null || true
      git push origin main 2>/dev/null && echo "  [3] Git: GitHub에 저장됨 ✅" || echo "  [3] Git: push 실패 (인터넷/SSH 확인)"
    fi
  else
    git pull --rebase origin main 2>/dev/null && echo "  [3] Git: GitHub에서 불러옴 ✅" || echo "  [3] Git: pull 건너뜀 (최초 clone 필요할 수 있음)"
  fi
else
  echo "  [3] glow-multi 없음 → Mac에서 clone:"
  echo "      git clone git@github.com:siastones2-hash/glow-multi.git ~/glow-multi"
fi

# 4) iCloud 공유 설정 복원 (다른 맥에서 올린 설정)
if [[ -f "$SHARED/cursor/mcp.json" && "$MODE" == "pull" ]]; then
  # 경로는 install-cursor-config.sh가 이 맥 HOME으로 다시 씀
  bash "$HOME/Scripts/mac-sync/install-cursor-config.sh" >/dev/null
fi

echo ""
echo "  ═══════════════════════════════════════"
echo "  ✅ $MODE 완료 ($(hostname -s))"
echo ""
echo "  📌 맥북에서 일 끝 → 「작업-저장」 실행"
echo "  📌 맥 스튜디오 시작 → 「작업-불러오기」 실행"
echo ""
echo "  iCloud Desktop 켜두면 AI 수거함도 자동 동기화"
echo "  ═══════════════════════════════════════"
echo ""

if [[ "$MODE" == "pull" ]]; then
  open -a "Cursor 2" "$GLOW" 2>/dev/null || open -a "Cursor" "$GLOW" 2>/dev/null || true
fi

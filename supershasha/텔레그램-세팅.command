#!/bin/bash
# 텔레그램 팀 그룹 연동 — 3명이 한 그룹방에서 알림 같이 보기
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
NODE="$DIR/.node-runtime/bin/node"
[[ -x "$NODE" ]] || NODE="$(command -v node)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  슈퍼샤샤 텔레그램 · 팀 그룹 (3명)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "【준비】"
echo "  1) 텔레그램에서 그룹 만들기 (예: 슈퍼샤샤 알림)"
echo "  2) 알림 받을 3명 + 봇을 그룹에 초대"
echo "  3) @BotFather → 봇 토큰 복사"
echo ""

open_new_window "https://t.me/BotFather"

read -r -p "봇 토큰 붙여넣기: " TG_TOKEN
if [[ -z "$TG_TOKEN" ]]; then echo "[!] 토큰 없음"; read -n1; exit 1; fi

echo ""
echo "그룹에 3명 + 봇 넣은 뒤, 그룹 채팅에서 /start 를 보내세요."
read -r -p "그룹 채팅 ID (모르면 Enter → 자동 감지): " TG_CHAT

export PUBLIC_URL="${PUBLIC_URL:-https://supershasha.onrender.com}"
ARGS=("$TG_TOKEN")
[[ -n "$TG_CHAT" ]] && ARGS+=("$TG_CHAT")

"$NODE" "$DIR/scripts/telegram-setup.mjs" "${ARGS[@]}" || { read -n1; exit 1; }

echo ""
echo "Render에도 같은 그룹 ID를 넣으세요 (Environment):"
echo "  TELEGRAM_BOT_TOKEN"
echo "  TELEGRAM_CHAT_ID   ← 그룹 ID (-100…)"
echo "  PUBLIC_URL=https://supershasha.onrender.com"
echo ""
echo "서버 재시작 중…"
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"
if supershasha_launchd_loaded; then
  launchctl kickstart -k "gui/$(id -u)/com.supershasha.server" 2>/dev/null || true
else
  supershasha_ensure
fi
echo "✅ 완료 — 그룹방에서 3명 모두 테스트 메시지 확인"
echo ""
read -n1 -s -r -p "Enter…"

#!/bin/bash
# 텔레그램 봇 연동 — BotFather 토큰 → .env + webhook
cd "$(dirname "$0")"
DIR="$(pwd)"
export SUPERSHASHA_DIR="$DIR"
NODE="$DIR/.node-runtime/bin/node"
[[ -x "$NODE" ]] || NODE="$(command -v node)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  슈퍼샤샤 텔레그램 연동"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1) @BotFather → /newbot 또는 기존 봇 → API Token 복사"
echo "2) 알림 받을 그룹/채널에 봇 초대 → /start 입력"
echo ""

open_new_window "https://t.me/BotFather"

read -r -p "봇 토큰 붙여넣기: " TG_TOKEN
if [[ -z "$TG_TOKEN" ]]; then echo "[!] 토큰 없음"; read -n1; exit 1; fi

read -r -p "채팅 ID (모르면 Enter → 자동 감지): " TG_CHAT

export PUBLIC_URL="${PUBLIC_URL:-https://supershasha.onrender.com}"
ARGS=("$TG_TOKEN")
[[ -n "$TG_CHAT" ]] && ARGS+=("$TG_CHAT")

"$NODE" "$DIR/scripts/telegram-setup.mjs" "${ARGS[@]}" || { read -n1; exit 1; }

echo ""
echo "Render에도 알림 쓰려면 Render Environment에 동일 값 추가:"
echo "  TELEGRAM_BOT_TOKEN"
echo "  TELEGRAM_CHAT_ID"
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
echo "✅ 완료 — 텔레그램에서 테스트 메시지 확인"
echo ""
read -n1 -s -r -p "Enter…"

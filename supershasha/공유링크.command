#!/bin/bash
# 슈퍼샤샤 — 인터넷 공유 링크 (Cloudflare, IP 확인창 없음)
cd "$(dirname "$0")"
DIR="$(cd "$(dirname "$0")" && pwd)"
export SUPERSHASHA_DIR="$DIR"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
PORT="${PORT:-3000}"
URL_FILE="$(dirname "$0")/공유URL.txt"
LOG="/tmp/supershasha-tunnel.log"
NODE="./.node-runtime/bin/node"
NPM="./.node-runtime/bin/npm"
if [ ! -x "$NODE" ]; then
  command -v node >/dev/null 2>&1 || { echo "[!] Node.js 필요: https://nodejs.org"; read -n1; exit 1; }
  NODE=node; NPM=npm
fi
export PATH="$(dirname "$NODE"):$PATH"

echo "=== npm install (처음 1회) ==="
"$NPM" install -q

echo "=== 서버 시작 :$PORT ==="
# shellcheck source=scripts/supershasha-server.sh
source "$DIR/scripts/supershasha-server.sh"
supershasha_ensure || { echo "[!] 서버 시작 실패"; read -n1; exit 1; }

pkill -f "localtunnel --port $PORT" 2>/dev/null || true
pkill -f "cloudflared tunnel" 2>/dev/null || true

echo "=== 공개 링크 연결 중… ==="
: > "$LOG"
npx --yes cloudflared tunnel --url "http://127.0.0.1:${PORT}" >>"$LOG" 2>&1 &
TUN=$!

PUBLIC=""
for i in $(seq 1 35); do
  PUBLIC=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -1)
  [[ -n "$PUBLIC" ]] && break
  sleep 1
done

if [[ -z "$PUBLIC" ]]; then
  echo "[!] 링크 생성 실패. 로그: $LOG"
  read -n1
  exit 1
fi

sleep 3

{
  echo "갱신: $(date '+%Y-%m-%d %H:%M')"
  echo ""
  echo "■ 공개 링크 (IP 확인창 없음 · 창 닫으면 끊김)"
  echo "  ${PUBLIC}"
  echo ""
  echo "  슈퍼샤샤: ${PUBLIC}/?tenant=sh4-op-internal"
  echo "  본사:     ${PUBLIC}/?tenant=master"
  echo "  나인스토리: ${PUBLIC}/?tenant=nine"
  echo ""
  echo "로그인: leestones/1234 · master/master1234 · nineadmin/nine1234"
  echo ""
  echo "■ 영구 주소: 배포-Render.command"
} | tee "$URL_FILE"

mkdir -p "$DIR/data"
echo -n "$PUBLIC" > "$DIR/data/public-base.txt"
echo "공개 주소 저장: data/public-base.txt"

echo ""
echo "공유 링크 (새 창 3개)…"
open_new_window "${PUBLIC}/?tenant=sh4-op-internal"
sleep 0.4
open_new_window "${PUBLIC}/?tenant=master"
sleep 0.4
open_new_window "${PUBLIC}/?tenant=nine"

echo ""
echo "링크 유지 중… (이 창을 닫으면 만료)"
wait $TUN 2>/dev/null

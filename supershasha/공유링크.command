#!/bin/bash
# 슈퍼샤샤 — 인터넷 공유 링크 (localtunnel)
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
URL_FILE="$(dirname "$0")/공유URL.txt"
LOG="/tmp/supershasha-lt.log"
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
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
pkill -f "localtunnel --port $PORT" 2>/dev/null || true
nohup "$NODE" server.js >>/tmp/supershasha-srv.log 2>&1 &

for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:${PORT}/api/config" >/dev/null 2>&1 && break
  sleep 0.5
done

echo "=== 공개 링크 연결 중… ==="
: > "$LOG"
npx --yes localtunnel --port "$PORT" >>"$LOG" 2>&1 &
TUN=$!

PUBLIC=""
for i in $(seq 1 30); do
  PUBLIC=$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$LOG" 2>/dev/null | head -1)
  [[ -n "$PUBLIC" ]] && break
  sleep 1
done

if [[ -z "$PUBLIC" ]]; then
  echo "[!] 링크 생성 실패. 로그: $LOG"
  read -n1
  exit 1
fi

{
  echo "갱신: $(date '+%Y-%m-%d %H:%M')"
  echo ""
  echo "■ 공개 링크 (이 창 닫으면 끊김)"
  echo "  ${PUBLIC}"
  echo ""
  echo "  본사(숨김): ${PUBLIC}/?tenant=sh4-op-internal"
  echo "  총판:       ${PUBLIC}/?tenant=master"
  echo "  나인스토리: ${PUBLIC}/?tenant=nine"
  echo ""
  echo "로그인: leestones/1234 · master/master1234 · nineadmin/nine1234"
  echo ""
  echo "■ 영구 주소: 배포-Render.command (Mac 꺼도 24시간)"
} | tee "$URL_FILE"

echo ""
echo "공유 링크: ${PUBLIC}/?tenant=sh4-op-internal"
open "${PUBLIC}/?tenant=sh4-op-internal"

echo ""
echo "링크 유지 중… (이 창을 닫으면 만료)"
wait $TUN 2>/dev/null

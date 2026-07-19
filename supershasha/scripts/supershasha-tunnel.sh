#!/bin/bash
# Cloudflare quick tunnel — 끊기면 자동 재연결 + public-base.txt 갱신
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERSHASHA_DIR="${SUPERSHASHA_DIR:-$(cd "${_SCRIPT_DIR}/.." && pwd)}"
PORT="${PORT:-3000}"
LOG="/tmp/supershasha-tunnel.log"
URL_FILE="$SUPERSHASHA_DIR/data/public-base.txt"

NODE="$(command -v node 2>/dev/null)"
[[ -x "$SUPERSHASHA_DIR/.node-runtime/bin/node" ]] && NODE="$SUPERSHASHA_DIR/.node-runtime/bin/node"
export PATH="$(dirname "$NODE"):$PATH"

mkdir -p "$SUPERSHASHA_DIR/data"

while true; do
  echo "[$(date '+%F %T')] tunnel start" >>"$LOG"
  npx --yes cloudflared tunnel --url "http://127.0.0.1:${PORT}" 2>&1 | while IFS= read -r line; do
    echo "$line" >>"$LOG"
    if [[ "$line" =~ (https://[a-z0-9-]+\.trycloudflare\.com) ]]; then
      echo -n "${BASH_REMATCH[1]}" >"$URL_FILE"
    fi
  done
  echo "[$(date '+%F %T')] tunnel exit — 5s 후 재시작" >>"$LOG"
  sleep 5
done

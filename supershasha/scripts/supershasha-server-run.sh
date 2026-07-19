#!/bin/bash
# launchd 전용 — 포트 정리 후 서버 1개만 실행
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERSHASHA_DIR="${SUPERSHASHA_DIR:-$(cd "${_SCRIPT_DIR}/.." && pwd)}"
PORT="${PORT:-3000}"
# shellcheck source=supershasha-server.sh
source "$_SCRIPT_DIR/supershasha-server.sh"

# exec 전 lockdir 방식은 trap이 실행되지 않아 stale lock 발생 → 제거
rm -rf "/tmp/supershasha-${PORT}.lockdir" 2>/dev/null || true

NODE="$(supershasha_node)"
[[ -z "$NODE" ]] && { echo "[!] Node.js 없음" >&2; exit 1; }

# launchd 재시작 시 이전 node가 포트 점유 → EADDRINUSE 방지
for _ in 1 2 3 4 5; do
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  [[ -z "$pids" ]] && break
  echo "[$(date '+%F %T')] clearing port ${PORT}: ${pids}" >&2
  echo "$pids" | xargs kill -TERM 2>/dev/null || true
  sleep 0.4
  pids=$(lsof -ti :"$PORT" 2>/dev/null || true)
  [[ -z "$pids" ]] && break
  echo "$pids" | xargs kill -9 2>/dev/null || true
  sleep 0.3
done

if lsof -ti :"$PORT" >/dev/null 2>&1; then
  echo "[!] port ${PORT} still in use" >&2
  exit 1
fi

cd "$SUPERSHASHA_DIR" || exit 1
export PORT
exec "$NODE" server.js

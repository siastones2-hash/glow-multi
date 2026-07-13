#!/bin/bash
cd "$(dirname "$0")"
NODE="./.node-runtime/bin/node"
NPM="./.node-runtime/bin/npm"
PORT="${PORT:-3000}"
if [ ! -x "$NODE" ]; then
  command -v node >/dev/null 2>&1 || { echo "[!] Node.js 없음. .node-runtime 설치 필요 또는 https://nodejs.org LTS 설치"; read -n1; exit 1; }
  NODE=node
  NPM=npm
fi
echo "=== npm install (처음 1회) ==="
"$NPM" install
echo "=== 슈퍼샤샤 서버 시작 (실연동) ==="
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null || true
( sleep 1
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    curl -sf "http://127.0.0.1:${PORT}/api/config" >/dev/null 2>&1 && break
    sleep 0.4
  done
  open "http://127.0.0.1:${PORT}/?tenant=nine"
) &
"$NODE" server.js

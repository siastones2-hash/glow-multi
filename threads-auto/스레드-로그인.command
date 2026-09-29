#!/bin/bash
cd "$(dirname "$0")"
export PATH="/Users/apple/glow-multi/.venv-barona/bin:/Users/apple/Projects/09-기타/.tools/node/bin:$PATH"

echo ""
echo "  🧵 Threads 로그인"
echo "  ─────────────────"
echo "  브라우저가 열리면 본인 스레드 계정으로 로그인하세요."
echo "  로그인 끝나면 터미널에서 Enter 치면 저장됩니다."
echo ""

python3 scripts/threads_login.py

echo ""
read -p "Enter 키로 닫기…" x

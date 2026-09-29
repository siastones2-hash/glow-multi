#!/bin/bash
cd "$(dirname "$0")"
export PATH="/Users/apple/Projects/09-기타/.tools/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ .env 생성됨"
fi

echo ""
echo "  Threads Auto — 작업 화면"
echo "  http://localhost:3847"
echo "  ─────────────────"
echo "  · 오늘 글: 화면에서 「오늘 글 만들기」"
echo "  · 터미널:  오늘-올리기.command"
echo "  · 자동:    자동발행-켜기.command"
echo ""

node bin/server.js

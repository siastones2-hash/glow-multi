#!/bin/bash
# 오늘 글 미리보기 → 확인 후 발행
cd "$(dirname "$0")"
export PATH="/Users/apple/Projects/09-기타/.tools/node/bin:/Users/apple/glow-multi/.venv-barona/bin:$PATH"

echo ""
echo "  ✍️  오늘 Threads 글"
echo "  ─────────────────"

node bin/run-once.js --dry-run
echo ""
read -p "  ↑ 이 글을 올릴까요? (y/n): " ans
if [[ "$ans" == "y" || "$ans" == "Y" || "$ans" == "ㅇ" ]]; then
  node bin/run-once.js
  echo ""
  echo "  ✅ 발행 완료 — @leestones2 프로필 확인"
else
  echo "  취소됨. UI에서 수정하려면 threads-auto.command 실행"
fi
echo ""
read -p "Enter 키로 닫기…" x

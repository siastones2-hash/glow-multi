#!/bin/bash
# 슈퍼샤샤 → GitHub push + Render Blueprint 안내
set -euo pipefail
GLOW="/Users/apple/glow-multi"
SRC="/Users/apple/Projects/07-슈퍼시아/supershasha"
DST="$GLOW/supershasha"

echo "=== supershasha → glow-multi 동기화 ==="
mkdir -p "$DST"
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude data --exclude .git \
  --exclude .node-runtime --exclude srv.log --exclude srv.pid \
  "$SRC/" "$DST/"

echo "=== GitHub push (siastones2-hash/glow-multi) ==="
cd "$GLOW"
git add supershasha/ render.yaml scripts/deploy-supershasha-render.sh 2>/dev/null || git add supershasha/ render.yaml
git status -sb | head -10

if git diff --cached --quiet; then
  echo "변경 없음 — 이미 최신"
else
  git -c user.email="siastones2-hash@users.noreply.github.com" -c user.name="siastones2-hash" \
    commit -m "Deploy supershasha to Render (monorepo)"
  git push origin main
  echo "OK pushed"
fi

echo ""
echo "Render Blueprint: https://dashboard.render.com/blueprints"
echo "저장소: siastones2-hash/glow-multi → render.yaml 자동 인식"
echo "입력: MORETHAN_API_KEY, ADMIN_PASSWORD (1234 등)"

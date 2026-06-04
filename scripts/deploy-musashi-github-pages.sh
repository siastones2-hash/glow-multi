#!/bin/bash
# MUSASHI OS — GitHub Pages (/musashi/ + img/)
set -euo pipefail
GLOW="/Users/apple/glow-multi"
SRC="/Users/apple/Projects/09-기타/musashi-site"
PAGES_URL="https://siastones2-hash.github.io/glow-multi/musashi/"
URL_FILE="$GLOW/docs/musashi/URL.txt"

[[ -f "$SRC/index.html" ]] || { echo "없음: $SRC/index.html"; exit 1; }

mkdir -p "$GLOW/docs/musashi"
cp "$SRC/index.html" "$GLOW/docs/musashi/index.html"
rsync -a --delete "$SRC/img/" "$GLOW/docs/musashi/img/"
[[ -d "$SRC/assets" ]] && rsync -a "$SRC/assets/" "$GLOW/docs/musashi/assets/"

WORK="$(mktemp -d)"
git clone --depth 1 -b gh-pages "git@github.com:siastones2-hash/glow-multi.git" "$WORK/repo"
mkdir -p "$WORK/repo/musashi"
cp "$SRC/index.html" "$WORK/repo/musashi/index.html"
rsync -a --delete "$SRC/img/" "$WORK/repo/musashi/img/"
[[ -d "$SRC/assets" ]] && rsync -a "$SRC/assets/" "$WORK/repo/musashi/assets/"
cd "$WORK/repo"
git add musashi/
git -c user.email="siastones2-hash@users.noreply.github.com" -c user.name="siastones2-hash" \
  commit -q -m "MUSASHI Trinity demo — $(date '+%Y-%m-%d %H:%M')" || true
git push origin gh-pages

{
  echo "갱신: $(date '+%Y-%m-%d %H:%M')"
  echo ""
  echo "MUSASHI Trinity 데모: $PAGES_URL"
  echo "로컬: $SRC/index.html"
} > "$URL_FILE"

echo ""
echo "  ✦ Trinity 데모 배포 완료 (1~2분 후 반영)"
echo "  ▶ $PAGES_URL"
echo ""

command -v open >/dev/null && open "$PAGES_URL" 2>/dev/null || true

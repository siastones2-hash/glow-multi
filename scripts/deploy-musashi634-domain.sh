#!/bin/bash
# musashi634.co.kr → leestones2-debug/musashi (gh-pages)
set -euo pipefail
GLOW="/Users/apple/glow-multi"
SRC="/Users/apple/Projects/09-기타/musashi-site"
CONF="$GLOW/scripts/musashi-domain.conf"
REPO_MUSASHI="git@github.com:siastones2-hash/musashi.git"
DEPLOY_KEY="$GLOW/scripts/keys/musashi-deploy"

[[ -f "$CONF" ]] && source "$CONF"
DOMAIN="${MUSASHI_DOMAIN:-musashi634.co.kr}"

if [[ -f "$DEPLOY_KEY" ]]; then
  chmod 600 "$DEPLOY_KEY" 2>/dev/null || true
  export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  REPO_MUSASHI="git@github.com-leestones2-debug:leestones2-debug/musashi.git"
else
  echo "⚠ deploy key 없음: $DEPLOY_KEY"
  echo "  leestones2-debug/musashi → Settings → Deploy keys 에 공개키 등록:"
  echo "  $GLOW/scripts/keys/musashi-deploy.pub"
  REPO_MUSASHI="git@github.com-leestones2-debug:leestones2-debug/musashi.git"
fi

[[ -f "$SRC/index.html" ]] || { echo "없음: $SRC/index.html"; exit 1; }

if ! git ls-remote "$REPO_MUSASHI" &>/dev/null; then
  echo "GitHub 저장소 접근 실패: $REPO_MUSASHI"
  exit 1
fi

WORK="$(mktemp -d)"
rsync -a --delete "$SRC/" "$WORK/site/" \
  --exclude '.git' --exclude '.DS_Store' --exclude 'captures' --exclude 'docs'
echo "$DOMAIN" > "$WORK/site/CNAME"
touch "$WORK/site/.nojekyll"

if git clone --depth 1 -b gh-pages "$REPO_MUSASHI" "$WORK/clone" 2>/dev/null; then
  rsync -a --delete "$WORK/site/" "$WORK/clone/" --exclude '.git'
  cd "$WORK/clone"
else
  git clone --depth 1 "$REPO_MUSASHI" "$WORK/clone"
  cd "$WORK/clone"
  git checkout -qb gh-pages 2>/dev/null || git checkout gh-pages
  rsync -a --delete "$WORK/site/" "$WORK/clone/" --exclude '.git'
fi

git add -A
git -c user.email="leestones2-debug@users.noreply.github.com" -c user.name="leestones2-debug" \
  commit -m "MUSASHI — $DOMAIN $(date '+%Y-%m-%d %H:%M')" || true
git push -u origin gh-pages

rm -rf "$WORK"

echo ""
echo "  ✓ musashi634.co.kr 배포 완료 (1~3분 후 반영)"
echo "  ▶ https://$DOMAIN/"
echo ""

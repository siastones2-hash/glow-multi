#!/bin/zsh
# 크레딧 수정 반영 → GitHub 푸시 → Render 자동 배포
set -e
cd "$(dirname "$0")"
REPO="$(pwd)"
KEY="$REPO/glow-multi/ssh_keys/id_ed25519"
SSH_CFG="$REPO/glow-multi/ssh_keys/config"

echo ""
echo "  ═══ GLOW 배포 (GitHub push) ═══"
echo ""

# 커밋 안 된 변경 있으면 커밋
if ! git diff --quiet glow-multi/server.js 2>/dev/null; then
  git add glow-multi/server.js
  git commit -m "fix: 크레딧 표시 오류 수정"
fi

# SSH 설정
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [[ -f "$KEY" && ! -f "$HOME/.ssh/id_ed25519" ]]; then
  cp "$KEY" "$HOME/.ssh/id_ed25519"
  cp "${KEY}.pub" "$HOME/.ssh/id_ed25519.pub"
  chmod 600 "$HOME/.ssh/id_ed25519"
fi

cat > "$SSH_CFG" <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $HOME/.ssh/id_ed25519
  IdentitiesOnly yes
  UseKeychain yes
  AddKeysToAgent yes
EOF

export GIT_SSH_COMMAND="ssh -F $SSH_CFG -o StrictHostKeyChecking=accept-new"
git remote set-url origin git@github.com:siastones2-hash/glow-multi.git 2>/dev/null || true

echo "GitHub에 푸시 중..."
if git push -u origin main; then
  echo ""
  echo "  ✓ 푸시 완료!"
  echo "  → Render가 연결돼 있으면 2~5분 뒤 glow-0wdh.onrender.com 반영"
  echo "  → 슈퍼관리자에서 GLOW 크레딧이 0 근처로 보이면 성공"
  echo ""
else
  echo ""
  echo "  ✗ 푸시 실패 — SSH 키를 GitHub에 등록했는지 확인하세요."
  echo "  https://github.com/settings/ssh/new"
  echo ""
  echo "  공개키 (복사해서 붙여넣기):"
  cat "${KEY}.pub" 2>/dev/null || cat "$HOME/.ssh/id_ed25519.pub"
  echo ""
fi

read "?엔터로 닫기... "

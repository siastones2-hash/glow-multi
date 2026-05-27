#!/bin/bash
# After adding the SSH public key to GitHub, run in Terminal.app:
#   bash /Users/apple/glow-multi/push-to-github.sh
set -euo pipefail
REPO=/Users/apple/glow-multi
KEY="$REPO/glow-multi/ssh_keys/id_ed25519"
SSH_CONFIG="$REPO/glow-multi/ssh_keys/config"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
  cp "$KEY" "$HOME/.ssh/id_ed25519"
  cp "${KEY}.pub" "$HOME/.ssh/id_ed25519.pub"
  chmod 600 "$HOME/.ssh/id_ed25519"
  chmod 644 "$HOME/.ssh/id_ed25519.pub"
fi

cat > "$SSH_CONFIG" <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $HOME/.ssh/id_ed25519
  IdentitiesOnly yes
EOF

export GIT_SSH_COMMAND="ssh -F $SSH_CONFIG"
git -C "$REPO" remote set-url origin https://github.com/siastones2-hash/glow-multi.git 2>/dev/null || true
git -C "$REPO" remote set-url origin git@github.com:siastones2-hash/glow-multi.git 2>/dev/null || true
git -C "$REPO" push git@github.com:siastones2-hash/glow-multi.git main
echo "Push succeeded."

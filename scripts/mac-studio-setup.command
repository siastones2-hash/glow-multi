#!/bin/zsh
# 맥 스튜디오(또는 새 맥)에서 최초 1회 실행
set -e
GLOW="$(cd "$(dirname "$0")/../.." && pwd)"
echo "glow-multi 맥 연동 설정: $GLOW"

if [[ ! -d "$GLOW/.git" ]]; then
  echo "glow-multi clone 먼저: git clone git@github.com:siastones2-hash/glow-multi.git ~/glow-multi"
  exit 1
fi

mkdir -p "$HOME/Scripts"
cp -R "$GLOW/scripts/mac-sync" "$HOME/Scripts/"
chmod +x "$HOME/Scripts/mac-sync/"*.sh

# iCloud에서 공유 스크립트 (Desktop/Documents 동기화 후)
ICLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/맥-공유설정/scripts"
if [[ -d "$ICLOUD" ]]; then
  cp "$ICLOUD/"*.command "$HOME/Desktop/" 2>/dev/null || true
  chmod +x "$HOME/Desktop/"*.command 2>/dev/null || true
fi

"$HOME/Scripts/mac-sync/sync.sh" pull
echo "완료. Cursor에서 glow-multi 열기."

#!/bin/bash
# 슈퍼샤샤 Render 영구 배포 (Chrome에서 Blueprint 연결)
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"
open_new_window "https://dashboard.render.com/blueprint/new"
cat <<'EOF'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Render Blueprint — 2분 설정
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. GitHub 연결 → 저장소: siastones2-hash/glow-multi
2. render.yaml 자동 인식 → Apply
3. 아래 두 값만 입력:
   MORETHAN_API_KEY = (.env 파일에 있는 키)
   ADMIN_PASSWORD   = 1234  (또는 원하는 비번)
4. Create / Deploy

완료 후 주소 예:
  https://supershasha.onrender.com

  본사(숨김): .../?tenant=sh4-op-internal
  본사:       .../?tenant=master
  나인:       .../?tenant=nine

EOF
read -n1 -s -r -p "Enter 키…"

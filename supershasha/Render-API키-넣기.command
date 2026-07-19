#!/bin/bash
# Render supershasha — MORETHAN API 키 + 재배포 (2분)
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=open-new-window.sh
source "$DIR/open-new-window.sh"

ENV_FILE="$DIR/.env"
KEY=$(grep '^MORETHAN_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
PASS=$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Render supershasha 환경변수"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Render 대시보드 → supershasha 서비스 → Environment"
echo "2. 아래 값 붙여넣기 (없으면 Add):"
echo ""
echo "   MORETHAN_API_KEY = ${KEY:-(.env 확인)}"
echo "   ADMIN_PASSWORD   = ${PASS:-1234}"
echo ""
echo "3. Save Changes → Manual Deploy"
echo ""
echo "완료 주소: https://supershasha.onrender.com/?tenant=master"
echo ""

open_new_window "https://dashboard.render.com/"
read -n1 -s -r -p "Enter…"

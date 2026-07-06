#!/bin/bash
# GLOW DB 로컬 백업 — 더블클릭 실행
# DATABASE_URL: /Users/apple/Projects/.accounts.env 에 한 줄 추가
#   GLOW_DATABASE_URL=postgres://...

set -euo pipefail
BACKUP_DIR="$HOME/Projects/backups/glow-db"
STAMP=$(date +%Y%m%d-%H%M%S)
ENV_FILE="$HOME/Projects/.accounts.env"

mkdir -p "$BACKUP_DIR"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE" 2>/dev/null || true
fi

URL="${GLOW_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  osascript -e 'display alert "GLOW DB 백업" message "Projects/.accounts.env 에 GLOW_DATABASE_URL= 을 넣어 주세요.\n\nRender → Postgres → Connect → External Database URL 복사" as critical'
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  osascript -e 'display alert "pg_dump 없음" message "터미널에서: brew install libpq\n그다음 PATH에 추가" as critical'
  exit 1
fi

OUT_SQL="$BACKUP_DIR/glow-${STAMP}.sql"
OUT_DUMP="$BACKUP_DIR/glow-${STAMP}.dump"

echo "백업 중 → $BACKUP_DIR"
pg_dump "$URL" --no-owner --no-acl -f "$OUT_SQL"
pg_dump "$URL" --no-owner --no-acl -Fc -f "$OUT_DUMP"

# 오래된 파일 60일 넘으면 삭제
find "$BACKUP_DIR" -type f \( -name 'glow-*.sql' -o -name 'glow-*.dump' \) -mtime +60 -delete 2>/dev/null || true

COUNT=$(find "$BACKUP_DIR" -type f -name 'glow-*' | wc -l | tr -d ' ')
osascript -e "display notification \"${OUT_DUMP##*/}\" with title \"GLOW DB 백업 완료\" subtitle \"폴더에 ${COUNT}개 파일\""
open "$BACKUP_DIR"

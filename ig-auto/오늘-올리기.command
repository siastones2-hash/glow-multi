#!/bin/bash
cd "$(dirname "$0")"
export PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"
/usr/bin/python3 scripts/post_playwright.py --force
echo
read -n 1 -p "엔터로 닫기..."

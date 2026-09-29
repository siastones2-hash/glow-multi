#!/bin/bash
cd "$(dirname "$0")"
bash scripts/install-launchd.sh
echo
read -n 1 -p "엔터로 닫기..."

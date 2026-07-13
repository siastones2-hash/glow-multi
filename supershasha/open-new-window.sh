#!/bin/bash
# URL을 브라우저 새 창으로 열기 (Mac)
open_new_window() {
  local url="$1"
  [[ -z "$url" ]] && return 1
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    osascript <<EOF 2>/dev/null
tell application "Google Chrome"
  make new window
  set URL of active tab of front window to "$url"
  activate
end tell
EOF
    return
  fi
  if [[ -d "/Applications/Brave Browser.app" ]]; then
    open -na "Brave Browser" --args --new-window "$url"
    return
  fi
  if [[ -d "/Applications/Microsoft Edge.app" ]]; then
    open -na "Microsoft Edge" --args --new-window "$url"
    return
  fi
  if [[ -d "/Applications/Safari.app" ]]; then
    osascript -e "tell application \"Safari\" to make new document with properties {URL:\"$url\"}" \
              -e 'tell application "Safari" to activate' 2>/dev/null || open -n "$url"
    return
  fi
  open -n "$url"
}

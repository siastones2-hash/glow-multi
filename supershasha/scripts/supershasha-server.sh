#!/bin/bash
# 슈퍼샤샤 로컬 서버 — 백그라운드 실행·상태 확인 (실행_Mac.command 등에서 source)
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERSHASHA_DIR="${SUPERSHASHA_DIR:-$(cd "${_SCRIPT_DIR}/.." && pwd)}"
PORT="${PORT:-3000}"
PID_FILE="/tmp/supershasha-${PORT}.pid"
LOG="/tmp/supershasha-srv.log"
LABEL="com.supershasha.server"
TUNNEL_LABEL="com.supershasha.tunnel"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
TUNNEL_PLIST="$HOME/Library/LaunchAgents/${TUNNEL_LABEL}.plist"
TUNNEL_LOG="/tmp/supershasha-tunnel.log"

supershasha_node() {
  local n="$SUPERSHASHA_DIR/.node-runtime/bin/node"
  if [[ -x "$n" ]]; then echo "$n"; return; fi
  command -v node 2>/dev/null
}

supershasha_health() {
  curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1
}

supershasha_launchd_loaded() {
  launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1
}

supershasha_stop_port() {
  lsof -ti :"$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
}

supershasha_start_nohup() {
  local NODE
  NODE="$(supershasha_node)"
  if [[ -z "$NODE" ]]; then echo "[!] Node.js 없음"; return 1; fi
  cd "$SUPERSHASHA_DIR" || return 1
  if supershasha_health; then return 0; fi
  supershasha_stop_port
  sleep 0.3
  nohup "$NODE" server.js >>"$LOG" 2>&1 &
  echo $! >"$PID_FILE"
  for _ in $(seq 1 40); do
    supershasha_health && return 0
    sleep 0.3
  done
  echo "[!] 서버 시작 실패. 로그: $LOG"
  tail -8 "$LOG" 2>/dev/null
  return 1
}

# launchd 없을 때 — 터미널 닫아도 유지 (Mac 재부팅 시 수동 시작)
supershasha_ensure() {
  if supershasha_health; then return 0; fi
  if supershasha_launchd_loaded; then
    launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    for _ in $(seq 1 30); do
      supershasha_health && return 0
      sleep 0.3
    done
  fi
  supershasha_start_nohup
}

supershasha_install_launchd() {
  local NODE NPM
  NODE="$(supershasha_node)"
  NPM="$(dirname "$NODE")/npm"
  [[ -x "$NPM" ]] || NPM="$(command -v npm 2>/dev/null)"
  if [[ -z "$NODE" ]]; then echo "[!] Node.js 없음"; return 1; fi
  cd "$SUPERSHASHA_DIR" || return 1
  if [[ -x "$NPM" ]]; then "$NPM" install -q 2>/dev/null || "$NPM" install; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${SUPERSHASHA_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SUPERSHASHA_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${PORT}</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>${LOG}</string>
  <key>StandardErrorPath</key>
  <string>${LOG}</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"
  for _ in $(seq 1 40); do
    supershasha_health && return 0
    sleep 0.3
  done
  echo "[!] launchd 등록 후 헬스체크 실패. 로그: $LOG"
  return 1
}

supershasha_uninstall_launchd() {
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  supershasha_stop_port
  rm -f "$PID_FILE"
}

supershasha_install_tunnel_launchd() {
  local NODE
  NODE="$(supershasha_node)"
  if [[ -z "$NODE" ]]; then echo "[!] Node.js 없음"; return 1; fi
  chmod +x "$SUPERSHASHA_DIR/scripts/supershasha-tunnel.sh"
  mkdir -p "$HOME/Library/LaunchAgents" "$SUPERSHASHA_DIR/data"
  cat >"$TUNNEL_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${TUNNEL_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SUPERSHASHA_DIR}/scripts/supershasha-tunnel.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>SUPERSHASHA_DIR</key>
    <string>${SUPERSHASHA_DIR}</string>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${TUNNEL_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${TUNNEL_LOG}</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/${TUNNEL_LABEL}" 2>/dev/null || launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$TUNNEL_PLIST" 2>/dev/null || launchctl load "$TUNNEL_PLIST"
  for _ in $(seq 1 45); do
    [[ -s "$SUPERSHASHA_DIR/data/public-base.txt" ]] && return 0
    sleep 1
  done
  echo "[!] 터널 URL 대기 시간 초과. 로그: $TUNNEL_LOG"
  return 1
}

supershasha_uninstall_tunnel_launchd() {
  launchctl bootout "gui/$(id -u)/${TUNNEL_LABEL}" 2>/dev/null || launchctl unload "$TUNNEL_PLIST" 2>/dev/null || true
  rm -f "$TUNNEL_PLIST"
  pkill -f "cloudflared tunnel" 2>/dev/null || true
}

supershasha_install_all_launchd() {
  supershasha_install_launchd && supershasha_install_tunnel_launchd
}

supershasha_uninstall_all_launchd() {
  supershasha_uninstall_tunnel_launchd
  supershasha_uninstall_launchd
}

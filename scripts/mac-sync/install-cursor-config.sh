#!/bin/bash
# 맥북 ↔ 맥 스튜디오 공용 Cursor/MCP 설정 (iCloud 동기화)
set -eo pipefail
HOME_DIR="${HOME}"
NODE="${HOME_DIR}/.local/node/bin/node"
MCP_FS="${HOME_DIR}/.local/mcp-glow/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
GLOW="${HOME_DIR}/glow-multi"
PROJECTS="${HOME_DIR}/Projects"

mkdir -p "${HOME_DIR}/.cursor" "${HOME_DIR}/.local/mcp-glow"

if [[ ! -x "${NODE}" ]]; then
  mkdir -p "${HOME_DIR}/.local/node"
  curl -fsSL https://nodejs.org/dist/v22.15.0/node-v22.15.0-darwin-arm64.tar.gz \
    | tar -xz -C "${HOME_DIR}/.local/node" --strip-components=1 2>/dev/null || true
fi
if [[ ! -f "${MCP_FS}" ]]; then
  (cd "${HOME_DIR}/.local/mcp-glow" && "${NODE}" -e \
    "require('child_process').execSync('npm init -y && npm install @modelcontextprotocol/server-filesystem',{stdio:'inherit'})") 2>/dev/null || true
fi

cat > "${HOME_DIR}/.cursor/mcp.json" <<EOF
{
  "mcpServers": {
    "glow-multi": {
      "command": "${NODE}",
      "args": [
        "${MCP_FS}",
        "${GLOW}",
        "${PROJECTS}"
      ]
    }
  }
}
EOF

cat > "${HOME_DIR}/.cursor/permissions.json" <<'EOF'
{
  "mcpAllowlist": ["*:*"],
  "terminalAllowlist": ["*"]
}
EOF

python3 << PY
import json, os, sqlite3
home = os.path.expanduser("~")
settings = os.path.join(home, "Library/Application Support/Cursor/User/settings.json")
base = {
    "cursor.composer.shouldAutoApplyDiffs": True,
    "cursor.agent.autoApplyEdits": True,
    "cursor.agent.autoRun": True,
    "cursor.agent.enableYoloMode": True,
    "security.workspace.trust.startupPrompt": "never",
}
data = json.load(open(settings)) if os.path.isfile(settings) else {}
data.update(base)
json.dump(data, open(settings, "w"), indent=4, ensure_ascii=False)

db = os.path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb")
key = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser"
if os.path.isfile(db):
    conn = sqlite3.connect(db)
    row = conn.execute("SELECT value FROM ItemTable WHERE key=?", (key,)).fetchone()
    if row:
        payload = json.loads(row[0])
        cs = payload.setdefault("composerState", {})
        cs["yoloEnableRunEverything"] = True
        cs["yoloOutsideWorkspaceDisabled"] = False
        cs["autoAcceptGenerateImageTool"] = True
        cs["autoAcceptWebSearchTool"] = True
        for mode in cs.get("modes4", []):
            mode["autoRun"] = True
            mode["fullAutoRun"] = True
        conn.execute("UPDATE ItemTable SET value=? WHERE key=?", (json.dumps(payload), key))
        conn.commit()
    conn.close()
PY

echo "cursor_config_ok"

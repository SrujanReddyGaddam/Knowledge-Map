#!/usr/bin/env bash
# macOS only: run Knowledge Map at login and restart it if it crashes (launchd user agent).
# Usage: scripts/install-launchd.sh [--label com.me.knowledge-map] [--port 7777] [--print | --uninstall]
#   (no flag)   write the plist to ~/Library/LaunchAgents and start the service
#   --print     only print the plist that would be written
#   --uninstall stop the service and remove the plist
set -euo pipefail

LABEL="com.knowledge-map"; MODE="install"; PORT="${KM_PORT:-7777}"
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --print) MODE="print"; shift;;
    --uninstall) MODE="uninstall"; shift;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
done

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/knowledge-map.log"
DOMAIN="gui/$(id -u)"

if [ "$MODE" = "uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"; echo "removed $LABEL"; exit 0
fi

[ -n "$NODE" ] || { echo "node not found on PATH" >&2; exit 1; }
[ -f "$PROJECT/config.json" ] || { echo "config.json missing: run  cp config.example.json config.json  and set your vault path(s)" >&2; exit 1; }
[ -f "$PROJECT/node_modules/vite/bin/vite.js" ] || { echo "dependencies missing: run  npm install" >&2; exit 1; }

render() { cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$PROJECT/node_modules/vite/bin/vite.js</string>
    <string>--port</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string><key>KM_PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
}

if [ "$MODE" = "print" ]; then render; exit 0; fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
render > "$PLIST"
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "started $LABEL -> http://knowledge.localhost:$PORT  (log: $LOG)"
echo "restart after editing config.json or vault-plugin.ts:  launchctl kickstart -k $DOMAIN/$LABEL"
echo "if a vault shows 0 notes, give $NODE Full Disk Access (System Settings > Privacy & Security)"

#!/bin/sh
# Installs Transporter as an on-demand local app (macOS):
# macOS keeps http://localhost:$PORT reserved, starts the server when you open
# the page, and the server stops by itself a few minutes after you close it.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${TRANSPORTER_PORT:-3737}"
IDLE_MINUTES="${TRANSPORTER_IDLE_MINUTES:-2}"
LABEL=com.transporter.app
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Transporter.log"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "Node.js est introuvable." >&2
  exit 1
fi
if [ ! -f "$ROOT/models/ggml-large-v3-turbo.bin" ] || ! command -v yt-dlp >/dev/null 2>&1; then
  echo "Dépendances manquantes : lance d'abord « npm run setup »." >&2
  exit 1
fi

echo "→ Construction de l'interface…"
npm run build --prefix "$ROOT" >/dev/null

echo "→ Compilation du lanceur…"
mkdir -p "$ROOT/bin"
clang -O2 -o "$ROOT/bin/transporter-activate" "$ROOT/scripts/launcher/activate.c"

echo "→ Enregistrement auprès de macOS (launchd)…"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/bin/transporter-activate</string>
    <string>$NODE</string>
    <string>$ROOT/server/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>IDLE_EXIT_MINUTES</key>
    <string>$IDLE_MINUTES</string>
  </dict>
  <key>Sockets</key>
  <dict>
    <key>Listener</key>
    <array>
      <dict>
        <key>SockNodeName</key>
        <string>127.0.0.1</string>
        <key>SockServiceName</key>
        <string>$PORT</string>
      </dict>
      <dict>
        <key>SockNodeName</key>
        <string>::1</string>
        <key>SockServiceName</key>
        <string>$PORT</string>
      </dict>
    </array>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"

URL="http://localhost:$PORT"
echo ""
echo "✓ Transporter est installé : $URL"
echo "  Ajoute cette adresse à tes favoris. Le serveur démarre quand tu l'ouvres"
echo "  et s'arrête seul ${IDLE_MINUTES} min après la fermeture de l'onglet."
echo "  Journal : $LOG"
open "$URL"

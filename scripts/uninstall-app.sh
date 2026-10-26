#!/bin/sh
# Removes the on-demand launcher installed by install-app.sh (your files in data/ are kept).
LABEL=com.transporter.app
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "✓ Transporter n'est plus lancé automatiquement."

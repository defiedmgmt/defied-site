#!/bin/zsh
# Installs the Defied Luminate helper for the person signed in to this Mac. Run it yourself, from this
# folder: ./install.sh   (add --with-bot only after reading README.txt's part about the export bot)
# It copies the helper to ~/Library/Application Support/Defied Luminate Helper, asks for this Mac's
# token once, and starts it in the background (launchd). Nothing here needs an admin password.
set -euo pipefail
HERE=${0:A:h}
APP="$HOME/Library/Application Support/Defied Luminate Helper"
LOGS="$HOME/Library/Logs/Defied Luminate Helper"
AGENTS="$HOME/Library/LaunchAgents"
NODE=$(command -v node || true)
[[ "$(uname)" == Darwin ]] || { echo "This is for a Mac."; exit 1; }
[[ -n "$NODE" ]] || { echo "Node isn't installed. Get Node 20 or newer from https://nodejs.org, then run this again."; exit 1; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
(( MAJOR >= 20 )) || { echo "Node $MAJOR is too old: the helper needs Node 20 or newer."; exit 1; }
mkdir -p "$APP" "$LOGS" "$AGENTS"
cp "$HERE/luminate-helper.mjs" "$HERE/export-bot.mjs" "$HERE/README.txt" "$APP/"
[[ -f "$APP/bot-config.json" ]] || cp "$HERE/bot-config.example.json" "$APP/bot-config.json"

if [[ ! -f "$APP/config.json" ]]; then
  echo "This Mac's helper token (the site's LUMINATE_HELPER_TOKEN holds it as name:token):"
  read -rs "TOKEN?Token: "; echo
  (( ${#TOKEN} >= 24 )) || { echo "That token is too short (24 characters or more)."; exit 1; }
  read -r "DEVICE?A name for this Mac [$(scutil --get ComputerName 2>/dev/null || hostname)]: "
  DEVICE=${DEVICE:-$(scutil --get ComputerName 2>/dev/null || hostname)}
  SITE_URL=${SITE_URL:-https://www.defiedmgmt.com}
  umask 077
  "$NODE" -e 'const [f, site, token, device] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ site, token, device, downloads: "~/Downloads", doneDir: "~/Downloads/Luminate (done)" }, null, 2));' "$APP/config.json" "$SITE_URL" "$TOKEN" "$DEVICE"
  chmod 600 "$APP/config.json"
fi

fill() { sed -e "s#__NODE__#$NODE#g" -e "s#__APP__#$APP#g" -e "s#__LOGS__#$LOGS#g" "$1" > "$2"; }
fill "$HERE/com.defiedmgmt.luminate-helper.plist" "$AGENTS/com.defiedmgmt.luminate-helper.plist"
launchctl bootout "gui/$(id -u)/com.defiedmgmt.luminate-helper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.defiedmgmt.luminate-helper.plist"

if [[ "${1:-}" == "--with-bot" ]]; then
  # the bot needs puppeteer-core next to it; it still does nothing until bot-config.json says "enabled": true
  (cd "$APP" && npm install --no-audit --no-fund --silent puppeteer-core@23.11.1)
  fill "$HERE/com.defiedmgmt.luminate-bot.plist" "$AGENTS/com.defiedmgmt.luminate-bot.plist"
  launchctl bootout "gui/$(id -u)/com.defiedmgmt.luminate-bot" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/com.defiedmgmt.luminate-bot.plist"
  echo "Export bot installed for Mondays 9:30 AM. It stays OFF until you set \"enabled\": true in:"
  echo "  $APP/bot-config.json"
  echo "Then sign in once: $NODE \"$APP/export-bot.mjs\" --sign-in"
fi

echo
"$NODE" "$APP/luminate-helper.mjs" --check || echo "The helper is installed, but the site didn't accept the token yet (see README.txt)."
echo "Installed. The helper's log: $LOGS/helper.log"
echo "If the log says it can't read Downloads: System Settings > Privacy & Security > Files and Folders"
echo "(or Full Disk Access) > allow \"node\" ($NODE)."

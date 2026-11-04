#!/bin/zsh
# Stops and removes the Defied Luminate helper (and the export bot, if it was installed).
# ./uninstall.sh          keeps your config and the bot's Chrome profile
# ./uninstall.sh --all    removes those too (you'd enter the token again on a reinstall)
set -uo pipefail
APP="$HOME/Library/Application Support/Defied Luminate Helper"
for label in com.defiedmgmt.luminate-helper com.defiedmgmt.luminate-bot; do
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
if [[ "${1:-}" == "--all" ]]; then rm -rf "$APP"; echo "Removed the helper, its config and the bot's Chrome profile."
else echo "Stopped and removed the helper. Your config is still in: $APP"; fi
echo "Files already moved to Downloads/Luminate (done) stay where they are."

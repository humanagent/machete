#!/bin/bash
# Builds build/Machete.app. Pass --install to copy it to /Applications and launch it.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
APP=build/Machete.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Machete "$APP/Contents/MacOS/Machete"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/*.svg "$APP/Contents/Resources/"
cp Resources/*.ttf Resources/Inter-LICENSE.txt "$APP/Contents/Resources/"

# Signing identity, in order of preference:
#  1. An Apple Development / Developer ID certificate, if you have one.
#  2. The local "Machete Code Signing" identity in its own keychain (see scripts/setup-signing.sh).
#     A stable identity keeps macOS permissions across rebuilds; its keychain is unlocked here so
#     codesign never prompts.
#  3. Ad-hoc (permissions reset on every rebuild).
KC="$HOME/Library/Keychains/machete-signing.keychain-db"
IDENTITY=$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development|Developer ID/ {print $2; exit}')
KC_ARGS=()
if [[ -z "$IDENTITY" && -f "$KC" ]]; then
  security unlock-keychain -p machete-local "$KC" 2>/dev/null || true
  IDENTITY=$(security find-identity -p codesigning "$KC" | awk '/Machete Code Signing/ {print $2; exit}')
  [[ -n "$IDENTITY" ]] && KC_ARGS=(--keychain "$KC")
fi
codesign --force --sign "${IDENTITY:--}" ${KC_ARGS[@]+"${KC_ARGS[@]}"} "$APP"
echo "Built $APP (signed: ${IDENTITY:-ad-hoc})"

if [[ "${1:-}" == "--install" ]]; then
  pkill -x Machete 2>/dev/null || true
  pkill -x gpt-helper 2>/dev/null || true
  rm -rf /Applications/Machete.app /Applications/gpt-helper.app
  cp -R "$APP" /Applications/
  open /Applications/Machete.app
  echo "Installed and launched /Applications/Machete.app"
fi

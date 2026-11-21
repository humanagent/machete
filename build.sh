#!/bin/bash
# Builds build/gpt-helper.app. Pass --install to copy it to /Applications and launch it.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
APP=build/gpt-helper.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/GPTHelper "$APP/Contents/MacOS/gpt-helper"
cp Resources/Info.plist "$APP/Contents/Info.plist"

# Use a stable signing identity if one exists (keeps macOS permissions across rebuilds); else ad-hoc.
IDENTITY=$(security find-identity -v -p codesigning | awk -F'"' '/Apple Development|Developer ID/ {print $2; exit}')
# Fall back to the local self-signed cert (stable identity => macOS keeps permissions across rebuilds).
if [[ -z "$IDENTITY" ]]; then
  IDENTITY=$(security find-identity -p codesigning | awk '/gpt-helper Local Signing/ {print $2; exit}')
fi
codesign --force --sign "${IDENTITY:--}" "$APP"
echo "Built $APP (signed: ${IDENTITY:-ad-hoc})"

if [[ "${1:-}" == "--install" ]]; then
  pkill -x gpt-helper 2>/dev/null || true
  rm -rf /Applications/gpt-helper.app
  cp -R "$APP" /Applications/
  open /Applications/gpt-helper.app
  echo "Installed and launched /Applications/gpt-helper.app"
fi

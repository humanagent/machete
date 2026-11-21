#!/bin/bash
# Builds a distributable build/<name>.dmg (app + Applications shortcut).
#
# Unsigned for others by default: on another Mac it will be blocked by Gatekeeper.
# To ship it, sign with Developer ID and notarize:
#   DEVELOPER_ID="Developer ID Application: <Name> (<TEAMID>)" \
#   NOTARY_PROFILE=<profile saved with `xcrun notarytool store-credentials`> \
#   scripts/make-dmg.sh
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${APP_NAME:-gpt-helper}"
APP=build/gpt-helper.app
DMG="build/${NAME}.dmg"

./build.sh

if [[ -n "${DEVELOPER_ID:-}" ]]; then
  echo "Signing with: $DEVELOPER_ID (hardened runtime)"
  codesign --force --options runtime --timestamp \
    --entitlements Resources/gpt-helper.entitlements \
    --sign "$DEVELOPER_ID" "$APP"
  codesign --verify --strict --verbose=2 "$APP"
fi

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

if [[ -n "${DEVELOPER_ID:-}" ]]; then
  codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"
fi

if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  echo "Notarizing (this can take a few minutes)…"
  xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
  spctl --assess --type open --context context:primary-signature --verbose "$DMG"
fi

echo "Built $DMG"
[[ -z "${DEVELOPER_ID:-}" ]] && echo "Note: not signed with Developer ID, so other Macs will block it. See the header of this script."
exit 0

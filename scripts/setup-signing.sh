#!/bin/bash
# One-time: creates a local self-signed code-signing identity in its own keychain so that
# macOS keeps Machete's permissions across rebuilds and codesign never prompts.
set -euo pipefail
KC="$HOME/Library/Keychains/machete-signing.keychain-db"
PW=machete-local
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
[[ -f "$KC" ]] || security create-keychain -p "$PW" "$KC"
security set-keychain-settings "$KC"
security unlock-keychain -p "$PW" "$KC"
if ! security find-identity -p codesigning "$KC" | grep -q "Machete Code Signing"; then
  openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 -nodes \
    -subj "/CN=Machete Code Signing" -addext "extendedKeyUsage=critical,codeSigning" \
    -addext "keyUsage=critical,digitalSignature" -addext "basicConstraints=critical,CA:false" 2>/dev/null
  openssl pkcs12 -export -legacy -out "$TMP/id.p12" -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -passout pass:x 2>/dev/null
  security import "$TMP/id.p12" -k "$KC" -P x -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PW" "$KC" >/dev/null
fi
EXIST=$(security list-keychains -d user | tr -d '"' | xargs)
echo "$EXIST" | grep -q machete-signing || security list-keychains -d user -s $EXIST "$KC"
echo "Signing identity ready."

#!/usr/bin/env bash
# Empaqueta todo lo necesario para instalar en otro equipo: vsix + install.sh + README.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
VSIX="dist-vsix/ghostcode-$VERSION.vsix"
[[ -f "$VSIX" ]] || npm run package
TMP=$(mktemp -d)
mkdir "$TMP/ghostcode"
cp "$VSIX" scripts/install.sh README.md "$TMP/ghostcode/"
tar czf "ghostcode-$VERSION-linux.tar.gz" -C "$TMP" ghostcode
rm -rf "$TMP"
echo "Creado ghostcode-$VERSION-linux.tar.gz"

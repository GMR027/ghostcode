#!/usr/bin/env bash
# Genera .vsix, .deb y .tar.gz en releases/.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
npm run package
bash scripts/dist.sh
bash scripts/build-deb.sh .
mkdir -p releases
mv -f "ghostcode-$VERSION-linux.tar.gz" "ghostcode_${VERSION}_all.deb" releases/
cp -f "dist-vsix/ghostcode-$VERSION.vsix" releases/
ls -l releases

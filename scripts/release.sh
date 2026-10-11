#!/usr/bin/env bash
# Genera .vsix, .deb y .tar.gz en releases/ (y quita los de versiones anteriores).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
npm run package
bash scripts/dist.sh
bash scripts/build-deb.sh .
mkdir -p releases
mv -f "ghostcode-$VERSION-linux.tar.gz" "ghostcode_${VERSION}_all.deb" releases/
cp -f "dist-vsix/ghostcode-$VERSION.vsix" releases/
# Solo se conserva la versión actual: los binarios de versiones anteriores se quitan (siguen en el historial de Git).
find releases -maxdepth 1 -type f \( -name 'ghostcode*.vsix' -o -name 'ghostcode*.deb' -o -name 'ghostcode*.tar.gz' \) ! -name "*$VERSION*" -print -delete | sed 's/^/Quitado: /'
ls -l releases

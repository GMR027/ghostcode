#!/usr/bin/env bash
# Crea el paquete ghostcode_<versión>_all.deb para Debian/Ubuntu y derivadas.
#   npm run deb                 → en la carpeta del proyecto
#   npm run deb -- /otra/carpeta
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$(cd "${1:-.}" && pwd)"
VERSION=$(node -p "require('./package.json').version")
VSIX="dist-vsix/ghostcode-$VERSION.vsix"
[[ -f "$VSIX" ]] || npm run package

ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT
chmod 755 "$ROOT"
install -Dm644 "$VSIX" "$ROOT/usr/share/ghostcode/ghostcode.vsix"
install -Dm755 scripts/install.sh "$ROOT/usr/share/ghostcode/install.sh"
install -Dm755 packaging/deb/ghostcode-setup "$ROOT/usr/bin/ghostcode-setup"
install -Dm644 README.md "$ROOT/usr/share/doc/ghostcode/README.md"
install -Dm644 LICENSE "$ROOT/usr/share/doc/ghostcode/copyright"
install -Dm755 packaging/deb/postinst "$ROOT/DEBIAN/postinst"
install -Dm755 packaging/deb/prerm "$ROOT/DEBIAN/prerm"

cat >"$ROOT/DEBIAN/control" <<EOF
Package: ghostcode
Version: $VERSION
Architecture: all
Maintainer: Edgar <e.gm27@outlook.com>
Section: devel
Priority: optional
Depends: bash, util-linux
Recommends: curl, python3
Installed-Size: $(du -sk "$ROOT/usr" | cut -f1)
Description: GhostCode - autocompletado de código con IA para VS Code
 Sugerencias en ghost text mientras escribes, como GitHub Copilot, con un
 modelo local en Ollama (gratis, privado, sin internet) o una API en la nube
 (Claude, Codestral, OpenAI, DeepSeek...). Incluye un panel lateral con
 modelos sugeridos según el hardware y herramientas para corregir la
 indentación y anotar código.
 .
 Al instalarse añade la extensión al VS Code del usuario que ejecutó sudo.
 Ejecuta 'ghostcode-setup' con tu usuario para instalar Ollama y el modelo.
EOF

DEB="$OUT/ghostcode_${VERSION}_all.deb"
dpkg-deb --root-owner-group -Zxz --build "$ROOT" "$DEB" >/dev/null
echo "Creado $DEB"

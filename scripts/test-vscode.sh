#!/usr/bin/env bash
# Lanza una instancia aislada de VS Code, ejecuta test-integration/suite.ts y muestra el resultado.
set -euo pipefail
cd "$(dirname "$0")/.."
node esbuild.mjs
mkdir -p out
npx esbuild test-integration/suite.ts --bundle --platform=node --format=cjs --external:vscode \
  --outfile=out/integration/index.js --log-level=error
export GHOSTCODE_RESULTS="$PWD/out/integration-results.txt"
rm -f "$GHOSTCODE_RESULTS"
TMP=$(mktemp -d)
# Proyecto de prueba: dos archivos JS, repositorio git con remoto de GitHub y un cambio sin confirmar.
WS="$TMP/ws"
mkdir -p "$WS/src" "$TMP/data/User"
echo '{"security.workspace.trust.enabled": false}' > "$TMP/data/User/settings.json"
cat > "$WS/src/geometria.js" <<'JS'
export class Figura {
  area() {
    return 0;
  }
}

export class Circulo extends Figura {
  constructor(radio) {
    super();
    this.radio = radio;
  }
  perimetro() {
    return 2 * Math.PI * this.radio;
  }
}
JS
mkdir -p "$WS/css" "$WS/js"
printf "body { margin: 0; }\n" > "$WS/css/estilos.css"
printf "console.log('ok');\n" > "$WS/js/app.js"
printf '<!DOCTYPE html>\n<html>\n<head>\n  <link rel="stylesheet" href="css/estilo.css">\n  <script src="js/app.js"></script>\n</head>\n</html>\n' > "$WS/index.html"
printf "import { Circulo } from './geometria.js';\nconst c = new Circulo(2);\nconsole.log(c.\n" > "$WS/src/main.js"
git -C "$WS" init -q -b main
git -C "$WS" add -A
git -C "$WS" -c user.name=prueba -c user.email=prueba@example.com commit -qm init
git -C "$WS" remote add origin git@github.com:edgar/demo.git
printf "export function sumar(a, b) {\n  return a + b;\n}\n" >> "$WS/src/main.js"
code --user-data-dir "$TMP/data" --extensions-dir "$TMP/ext" --disable-extensions \
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/out/integration/index.js" --new-window "$WS" >/dev/null 2>&1 || true
for _ in $(seq 1 60); do [[ -f "$GHOSTCODE_RESULTS" ]] && break; sleep 1; done
rm -rf "$TMP" 2>/dev/null || true  # VS Code puede seguir escribiendo al cerrarse
[[ -f "$GHOSTCODE_RESULTS" ]] || { echo "Sin resultados (¿VS Code no arrancó?)"; exit 1; }
cat "$GHOSTCODE_RESULTS"
! grep -q "✘" "$GHOSTCODE_RESULTS"

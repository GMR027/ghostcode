#!/usr/bin/env bash
# Prueba GhostCode en un proyecto real con TU configuración y TUS extensiones, en una
# instancia aislada de VS Code. Trabaja sobre copias: el proyecto no se modifica.
#   npm run test:project -- /ruta/al/proyecto
#   GHOSTCODE_MODEL=qwen2.5-coder:3b-base npm run test:project -- /ruta   (probar otro modelo)
set -euo pipefail
PROJECT="$(cd "${1:?Uso: npm run test:project -- /ruta/al/proyecto}" && pwd)"
cd "$(dirname "$0")/.."
node esbuild.mjs
mkdir -p out
npx esbuild test-integration/project.ts --bundle --platform=node --format=cjs --external:vscode \
  --outfile=out/integration/project.js --log-level=error
export GHOSTCODE_RESULTS="$PWD/out/project-results.txt" GHOSTCODE_PROJECT="$PROJECT" GHOSTCODE_ONLY="${GHOSTCODE_ONLY:-}"
rm -f "$GHOSTCODE_RESULTS"

TMP=$(mktemp -d)
mkdir -p "$TMP/data/User" "$TMP/ext"
# Tu settings.json (p. ej. chat.disableAIFeatures) + sin diálogo de confianza del espacio de trabajo.
python3 - "$HOME/.config/Code/User/settings.json" "$TMP/data/User/settings.json" <<'PY'
import json, os, re, sys
try:
    text = open(sys.argv[1], encoding="utf-8").read()
    text = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*[\s\S]*?\*/', lambda m: m.group(1) or "", text)
    obj = json.loads(re.sub(r",(\s*[}\]])", r"\1", text) or "{}")
except (OSError, ValueError):
    obj = {}
obj["security.workspace.trust.enabled"] = False
if os.environ.get("GHOSTCODE_MODEL"):
    obj["ghostcode.local.model"] = os.environ["GHOSTCODE_MODEL"]
open(sys.argv[2], "w", encoding="utf-8").write(json.dumps(obj))
PY
# Tus extensiones instaladas (enlazadas, sin copiar), salvo la GhostCode instalada: se prueba la de este repo.
for e in "$HOME"/.vscode/extensions/*/; do
  name=$(basename "$e")
  [[ $name == edgar.ghostcode-* ]] || ln -s "$e" "$TMP/ext/$name"
done

code --user-data-dir "$TMP/data" --extensions-dir "$TMP/ext" --new-window \
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/out/integration/project.js" "$PROJECT" >/dev/null 2>&1 || true
for _ in $(seq 1 900); do [[ -f "$GHOSTCODE_RESULTS" ]] && break; sleep 1; done
sleep 2
# Conservar el registro de GhostCode de la instancia de prueba.
find "$TMP/data/logs" -name "*GhostCode*.log" -exec cat {} + > out/project-ghostcode.log 2>/dev/null || true
rm -rf "$TMP" 2>/dev/null || true
[[ -f "$GHOSTCODE_RESULTS" ]] || { echo "Sin resultados (¿VS Code no arrancó?)"; exit 1; }
cat "$GHOSTCODE_RESULTS"
! grep -q "✘" "$GHOSTCODE_RESULTS"

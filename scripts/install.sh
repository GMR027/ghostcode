#!/usr/bin/env bash
# Instalador de GhostCode (autocompletado IA para VS Code) en Linux.
#
#   ./install.sh                      instalación interactiva
#   ./install.sh --mode local --yes   sin preguntas, modo local, modelo según hardware
#   ./install.sh --mode api           solo la extensión (luego eliges proveedor en VS Code)
#   ./install.sh --model qwen2.5-coder:7b-base
#   ./install.sh --uninstall
#   ./install.sh --extension-only     solo instala/actualiza la extensión (lo usa el paquete .deb)
set -euo pipefail

EXT_ID="edgar.ghostcode"
MODE=""
MODEL=""
YES=0
EXT_ONLY=0
UNINSTALL=0
VSIX=""
EDITOR_CLI=""

c_blue=$'\e[1;34m'; c_green=$'\e[1;32m'; c_yellow=$'\e[1;33m'; c_red=$'\e[1;31m'; c_off=$'\e[0m'
info() { echo "${c_blue}==>${c_off} $*"; }
ok()   { echo "${c_green}✔${c_off} $*"; }
warn() { echo "${c_yellow}!${c_off} $*"; }
die()  { echo "${c_red}✘ $*${c_off}" >&2; exit 1; }

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --vsix) VSIX="$2"; shift 2 ;;
    --editor) EDITOR_CLI="$2"; shift 2 ;;
    -y|--yes) YES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --extension-only) EXT_ONLY=1; shift ;;
    -h|--help) usage ;;
    *) die "Opción desconocida: $1 (usa --help)" ;;
  esac
done

confirm() { # confirm "pregunta" → 0 si sí
  [[ $YES -eq 1 ]] && return 0
  local r; read -r -p "$1 [S/n] " r </dev/tty || true
  [[ -z "$r" || "$r" =~ ^[sSyY] ]]
}

# --- Editor: VS Code, VS Code Insiders o VSCodium --------------------------------
find_editor() {
  if [[ -n "$EDITOR_CLI" ]]; then command -v "$EDITOR_CLI" >/dev/null || die "No se encontró '$EDITOR_CLI'"; return; fi
  for c in code code-insiders codium; do
    if command -v "$c" >/dev/null 2>&1; then EDITOR_CLI="$c"; return; fi
  done
  die "No se encontró VS Code ('code'). Instálalo desde https://code.visualstudio.com/ y vuelve a ejecutar."
}

settings_file() {
  case "$EDITOR_CLI" in
    code-insiders) echo "$HOME/.config/Code - Insiders/User/settings.json" ;;
    codium) echo "$HOME/.config/VSCodium/User/settings.json" ;;
    *) echo "$HOME/.config/Code/User/settings.json" ;;
  esac
}

# Escribe ajustes ghostcode.* en settings.json (admite comentarios/comas finales de VS Code).
write_settings() { # write_settings clave=valorJSON ...
  local file; file="$(settings_file)"
  mkdir -p "$(dirname "$file")"
  [[ -f "$file" ]] || echo "{}" >"$file"
  command -v python3 >/dev/null 2>&1 || { warn "python3 no está disponible; configura GhostCode desde VS Code (barra de estado)."; return; }
  python3 - "$file" "$@" <<'EOF'
import json, re, shutil, sys
file, pairs = sys.argv[1], sys.argv[2:]
text = open(file, encoding="utf-8").read()
# settings.json admite comentarios y comas finales: quitarlos antes de parsear.
text = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*|/\*[\s\S]*?\*/', lambda m: m.group(1) or "", text)
text = re.sub(r",(\s*[}\]])", r"\1", text)
try:
    obj = json.loads(text or "{}")
except ValueError:
    print("  settings.json no se pudo leer; no se modificó.", file=sys.stderr)
    sys.exit(0)
shutil.copyfile(file, file + ".bak-ghostcode")
for p in pairs:
    k, v = p.split("=", 1)
    obj[k] = json.loads(v)
open(file, "w", encoding="utf-8").write(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
EOF
}

# --- Desinstalar ------------------------------------------------------------------
if [[ $UNINSTALL -eq 1 ]]; then
  find_editor
  "$EDITOR_CLI" --uninstall-extension "$EXT_ID" && ok "Extensión desinstalada de $EDITOR_CLI"
  warn "Ollama y los modelos descargados se conservan. Para borrarlos: 'ollama rm <modelo>' y ver https://github.com/ollama/ollama/blob/main/docs/linux.md"
  exit 0
fi

# --- Paquete .vsix ----------------------------------------------------------------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "$VSIX" ]]; then
  VSIX="$(ls -t "$HERE"/*.vsix "$HERE"/../dist-vsix/*.vsix 2>/dev/null | head -1 || true)"
fi
[[ -n "$VSIX" && -f "$VSIX" ]] || die "No se encontró el archivo .vsix (genéralo con 'npm run package' o pásalo con --vsix)."

find_editor
info "Editor: $EDITOR_CLI · Paquete: $(basename "$VSIX")"

if [[ $EXT_ONLY -eq 1 ]]; then
  "$EDITOR_CLI" --install-extension "$VSIX" --force >/dev/null
  ok "Extensión instalada en $EDITOR_CLI"
  exit 0
fi

# --- Modo -------------------------------------------------------------------------
if [[ -z "$MODE" ]]; then
  if [[ $YES -eq 1 ]]; then MODE="local"; else
    echo
    echo "¿Qué modo quieres usar? (se puede cambiar después desde la barra de estado de VS Code)"
    echo "  1) Local  — modelo en este equipo con Ollama (gratis, privado, sin internet)"
    echo "  2) API    — proveedor en la nube con API key (Claude, Codestral, OpenAI, DeepSeek…)"
    echo "  3) Ambos  — instala Ollama y deja todo listo para alternar"
    read -r -p "Elige [1/2/3] (1): " r </dev/tty || true
    case "${r:-1}" in 2) MODE="api" ;; 3) MODE="both" ;; *) MODE="local" ;; esac
  fi
fi
[[ "$MODE" =~ ^(local|api|both)$ ]] || die "--mode debe ser local, api o both"

# --- Hardware y modelo recomendado ------------------------------------------------
detect_vram_mb() {
  local v=0
  if command -v nvidia-smi >/dev/null 2>&1; then
    v=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | sort -nr | head -1 || echo 0)
  fi
  for f in /sys/class/drm/card*/device/mem_info_vram_total; do
    [[ -r "$f" ]] || continue
    local mb=$(( $(cat "$f") / 1024 / 1024 ))
    (( mb > v )) && v=$mb
  done
  echo "${v:-0}"
}

pick_model() {
  local vram ram
  vram=$(detect_vram_mb)
  ram=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / 1024 ))
  info "Hardware: VRAM ${vram} MB · RAM ${ram} MB" >&2
  # Prima la latencia del autocompletado (mismos umbrales que src/core/models.ts).
  if   (( vram >= 16000 )); then echo "qwen2.5-coder:7b-base"
  elif (( vram >= 10000 )); then echo "qwen2.5-coder:3b-base"
  elif (( vram >= 3000 || ram >= 16000 )); then echo "qwen2.5-coder:1.5b-base"
  else echo "qwen2.5-coder:0.5b-base"
  fi
}

# --- Ollama -----------------------------------------------------------------------
ollama_up() { curl -fsS --max-time 3 http://localhost:11434/api/version >/dev/null 2>&1; }

setup_ollama() {
  if ! command -v ollama >/dev/null 2>&1; then
    info "Ollama no está instalado."
    command -v curl >/dev/null || die "Se necesita 'curl' para instalar Ollama (sudo apt install curl)."
    confirm "¿Instalar Ollama ahora con el instalador oficial (pide sudo)?" || die "Instala Ollama manualmente: https://ollama.com/download"
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  ok "Ollama $(ollama --version 2>/dev/null | awk '{print $NF}')"

  if ! ollama_up; then
    info "Iniciando el servicio de Ollama…"
    if command -v systemctl >/dev/null && systemctl list-unit-files ollama.service >/dev/null 2>&1; then
      sudo systemctl enable --now ollama || true
    fi
    if ! ollama_up; then nohup ollama serve >/tmp/ollama-ghostcode.log 2>&1 & fi
    for _ in $(seq 1 20); do ollama_up && break; sleep 0.5; done
    ollama_up || die "Ollama no arrancó. Revisa: journalctl -u ollama"
  fi
  ok "Servidor Ollama activo en http://localhost:11434"

  [[ -n "$MODEL" ]] || MODEL="$(pick_model)"
  info "Modelo: $MODEL"
  if ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$MODEL"; then
    ok "El modelo ya estaba descargado"
  else
    ollama pull "$MODEL"
  fi

  # Comprobar que el modelo carga y si usa GPU.
  info "Probando el modelo…"
  curl -fsS http://localhost:11434/api/generate \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"def suma(a, b):\",\"suffix\":\"\\n\",\"stream\":false,\"keep_alive\":\"30m\",\"options\":{\"num_predict\":16}}" \
    >/dev/null || die "El modelo no respondió."
  local proc
  proc=$(ollama ps 2>/dev/null | awk -v m="$MODEL" '$1==m {for(i=1;i<=NF;i++) if ($i ~ /GPU|CPU/) {print $(i-1), $i; exit}}')
  ok "Modelo funcionando (${proc:-procesador desconocido})"
  if [[ "$proc" == *CPU* && "$proc" != *GPU* ]] && lspci 2>/dev/null | grep -qiE 'vga.*(amd|ati)'; then
    warn "Tu GPU AMD no se está usando. Prueba: sudo systemctl edit ollama → [Service] Environment=\"OLLAMA_VULKAN=1\""
    warn "o, con ROCm en RDNA2 (RX 6600/6700): Environment=\"HSA_OVERRIDE_GFX_VERSION=10.3.0\"; luego sudo systemctl restart ollama"
  fi
}

if [[ "$MODE" == "local" || "$MODE" == "both" ]]; then
  setup_ollama
fi

# --- Extensión --------------------------------------------------------------------
info "Instalando la extensión…"
"$EDITOR_CLI" --install-extension "$VSIX" --force >/dev/null
ok "Extensión instalada en $EDITOR_CLI"

settings=()
case "$MODE" in
  local|both) settings+=("ghostcode.mode=\"local\"" "ghostcode.local.model=\"$MODEL\"") ;;
  api) settings+=("ghostcode.mode=\"api\"") ;;
esac
# Activar el ghost text del editor por si estaba desactivado.
settings+=("editor.inlineSuggest.enabled=true")
write_settings "${settings[@]}"
ok "Configuración guardada en $(settings_file)"

echo
ok "¡Listo! Abre (o recarga) VS Code."
echo "   • El ghost text aparece al escribir. Tab = aceptar · Ctrl+→ = aceptar palabra · Esc = descartar · Alt+\\ = pedir sugerencia"
echo "   • Clic en «GhostCode» en la barra de estado para cambiar entre Local / API / Desactivado"
if [[ "$MODE" != "local" ]]; then
  echo "   • Modo API: barra de estado → «Configurar proveedor API…» para elegir proveedor, modelo y guardar la API key"
fi

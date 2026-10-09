# GhostCode — autocompletado de código con IA para VS Code

**GhostCode** sugiere código mientras escribes, en *ghost text* (texto gris que aceptas con `Tab`). Puedes usarlo **gratis y sin internet** con un modelo en tu propio equipo (Ollama) o con un
proveedor en la nube (Claude, Codestral, OpenAI, DeepSeek, OpenRouter…). Además incluye un panel con
herramientas para documentar, arreglar, explicar y organizar tu código, que funcionan con cualquier lenguaje.

---

## Función principal: autocompletado

- Sugerencias de **una línea o de bloques completos** mientras escribes, con el código de antes **y de después**
  del cursor (*fill-in-the-middle*).
- **Dos modos**, intercambiables en caliente:

  | Modo | Cómo funciona | Ventajas |
  |---|---|---|
  | **Local** | Un modelo en tu equipo con [Ollama](https://ollama.com) | Gratis, privado, sin internet |
  | **API** | Anthropic Claude, Mistral Codestral o cualquier API compatible con OpenAI | Máxima calidad, no depende de tu hardware |

- **Conoce tu proyecto**: añade al modelo la API real de las clases y funciones que usas (incluidos los métodos
  heredados), fragmentos parecidos de otras pestañas y, si lo activas, tu forma de escribir (Halo IA).
- Rápido: caché, cancelación de peticiones viejas y corte en cuanto el bloque está completo.
- Nunca envía archivos `.env` ni claves (`.pem`, `.key`…).

## Herramientas incluidas

Todas están en el panel de GhostCode (icono del fantasma en la barra lateral), organizado en pestañas.

| Pestaña | Herramienta | Qué hace |
|---|---|---|
| **Herramientas** | **Documentar función** | Escribe la documentación de la función bajo el cursor en el formato del lenguaje: JSDoc, PHPDoc, Javadoc, docstring de Python, `///` de C#/Rust/Swift, Go, Ruby, Lua, R… |
| | **Rename** | Sugiere 3 nombres según lo que hace la función seleccionada (en la convención del archivo) y la renombra en todo el proyecto. |
| | **Anotar selección** | Inserta encima del código seleccionado un comentario que explica qué hace. |
| | **Arreglar error con IA** | Sobre cualquier error o advertencia (también con `Ctrl+.`) propone un arreglo y te muestra el cambio antes de aplicarlo. |
| | **Corrección de rutas** | Revisa `href`, `src`, `import`, `require`, `include`, `url()`, `@use`… y marca las rutas que no existen en tu proyecto, con la corrección propuesta. **Mostrar rutas rota(s)** las lista por archivo con «Ir» y «Corregir». |
| | **Corregir indentación** | Corrige la sangría de la selección o del archivo con el número de espacios que elijas, sin tocar nada más. |
| | **Explicar al pasar el puntero** | Al pasar el ratón sobre una función, clase, consulta **SQL** o **expresión regular**, muestra qué hace (y avisa si un SQL es vulnerable a inyección). |
| **IA** | **Halo IA** | Analiza una carpeta o un repositorio tuyo y aprende cómo escribes (estilo, nombres, hábitos). Mientras VS Code esté abierto, el autocompletado y las herramientas imitan tu estilo. **Guardar temporal** conserva el análisis al cerrar y reabrir VS Code (sin volver a meter las carpetas) hasta que pulses **Limpiar**. |
| | **Prompt** | Convierte el código seleccionado en un prompt reutilizable para otro proyecto: **Copiar** o **Crear md-prompt** (lo guarda en `PROMPTS.md`). **Prompt y contexto del proyecto** crea `PROJECT-CONTEXT.md`: de qué trata, objetivo, lenguajes, estructura, frontend y backend. |
| **Proyecto** | **Conexión GitHub** | Repositorio, rama, cambios y remoto; si no hay repositorio, lo indica. **Generar mensaje de commit** escribe el mensaje a partir de tus cambios. |
| | **Extensiones recomendadas** | Según los lenguajes y herramientas del proyecto, con botón para instalarlas. |
| **Modelos** | **Modelos** | Los modelos que tienes en Ollama y los recomendados para tu GPU y RAM, con descarga en un clic. |

---

## Requisitos (instálalos antes)

| Necesitas | Para qué | Cómo conseguirlo |
|---|---|---|
| **Visual Studio Code 1.90 o superior** (o VSCodium) | Es donde funciona GhostCode | [code.visualstudio.com](https://code.visualstudio.com/) |
| **Ollama** | Modo Local (gratis y sin internet) | El instalador `.deb` lo instala por ti (`ghostcode-setup`); también desde [ollama.com/download](https://ollama.com/download) |
| **Espacio en disco: 1–5 GB** | Los modelos locales | — |
| **8 GB de RAM** (16 GB recomendado) | Modo Local | Con GPU (NVIDIA, AMD o Apple Silicon) las sugerencias son mucho más rápidas, pero no es obligatoria |
| **Una API key** | Solo si usas el modo API | De Anthropic, Mistral, OpenAI, DeepSeek, OpenRouter… |
| `curl` y `python3` | El instalador para Linux | Vienen en casi todas las distribuciones: `sudo apt install curl python3` |
| `git` | Conexión GitHub y analizar repositorios con Halo IA | `sudo apt install git` |

> Si tienes **GitHub Copilot** u otra extensión de autocompletado activa, desactívala para que no compitan
> (en VS Code: ajuste `chat.disableAIFeatures` o desactivar la extensión).

---

## Instalación

Los instaladores están en la carpeta [`releases/`](releases/) de este repositorio.

### Opción 1 — Debian, Ubuntu, Linux Mint, Zorin OS, Pop!_OS… (recomendada)

1. Descarga [`ghostcode_0.7.0_all.deb`](releases/ghostcode_0.7.0_all.deb) (botón **Download raw file**).
2. Instálalo (añade la extensión a tu VS Code y el comando `ghostcode-setup`):

   ```bash
   sudo apt install ./ghostcode_0.7.0_all.deb
   ```

3. Con tu usuario (sin `sudo`), configura el modo:

   ```bash
   ghostcode-setup
   ```

   Te pregunta **Local / API / Ambos**. En modo Local instala Ollama si falta, elige el modelo según tu GPU/RAM
   y lo descarga:

   | Tu equipo | Modelo de autocompletado |
   |---|---|
   | GPU con 16 GB o más | `qwen2.5-coder:7b-base` |
   | GPU con 10 GB o más | `qwen2.5-coder:3b-base` |
   | GPU con 3 GB o más, o 16 GB de RAM | `qwen2.5-coder:1.5b-base` |
   | Menos | `qwen2.5-coder:0.5b-base` |

4. Abre (o recarga) VS Code.

Para desinstalar: `sudo apt remove ghostcode` (Ollama y los modelos se conservan).

### Opción 2 — Cualquier sistema (Windows, macOS u otras distribuciones Linux)

1. Descarga [`ghostcode-0.7.0.vsix`](releases/ghostcode-0.7.0.vsix).
2. Instálalo en VS Code: menú **Extensiones** → `···` → **Instalar desde VSIX…**, o en una terminal:

   ```bash
   code --install-extension ghostcode-0.7.0.vsix
   ```

3. Para el modo Local, instala [Ollama](https://ollama.com/download) y descarga los modelos:

   ```bash
   ollama pull qwen2.5-coder:1.5b-base   # autocompletado
   ollama pull qwen2.5-coder:3b          # herramientas (documentar, arreglar, explicar…)
   ```

En otras distribuciones Linux también puedes usar [`ghostcode-0.7.0-linux.tar.gz`](releases/ghostcode-0.7.0-linux.tar.gz),
que trae el mismo instalador: `tar xzf ghostcode-0.7.0-linux.tar.gz && cd ghostcode && ./install.sh`.

### Opción 3 — Desde el código fuente

Necesitas además **Node.js 20+** y **npm**.

```bash
git clone https://github.com/GMR027/ghostcode.git
cd ghostcode
npm ci
npm run package                # crea dist-vsix/ghostcode-<versión>.vsix
code --install-extension dist-vsix/ghostcode-*.vsix
```

---

## Uso

### Autocompletar

Escribe con normalidad: la sugerencia aparece en gris.

| Acción | Tecla |
|---|---|
| Aceptar la sugerencia | `Tab` |
| Aceptar palabra a palabra | `Ctrl+→` |
| Aceptar una línea | `Ctrl+Alt+→` |
| Descartar | `Esc` |
| Pedir una sugerencia ahora | `Alt+\` |
| Ver otra alternativa | `Alt+]` / `Alt+[` |

### El panel

Haz clic en el **fantasma** de la barra lateral izquierda:

- **Arriba**: interruptor para activar/pausar el autocompletado y el selector **Local / API**.
- **Herramientas**: coloca el cursor en una función (o selecciona código) y pulsa la herramienta. Documentar,
  Rename, Anotar, Arreglar e Indentación también están en el **menú del clic derecho** del editor, y los arreglos
  de errores y rutas en la bombilla (`Ctrl+.`).
- **IA**: en **Halo IA** escribe la ruta de un proyecto tuyo (o la URL de un repositorio) y pulsa **Analizar**. Con **Guardar temporal** el análisis se conserva
  entre sesiones; con **Limpiar** se borra por completo;
  en **Prompt**, selecciona código y pulsa **Crear prompt del código seleccionado**.
- **Proyecto**: estado del repositorio, **Generar mensaje de commit** y extensiones recomendadas.
- **Modelos**: cambia de modelo local o descarga los recomendados.

Todos los comandos están también en la paleta (`Ctrl+Shift+P` → «GhostCode»).

### Modo API

En el panel, elige **API** (o barra de estado → **Configurar proveedor API…**). Un asistente te pide el
proveedor, la URL (si hace falta), el modelo y la API key.

- Las API keys se guardan **cifradas** en el llavero del sistema, nunca en `settings.json`. También se leen de
  `ANTHROPIC_API_KEY`, `CODESTRAL_API_KEY`/`MISTRAL_API_KEY` u `OPENAI_API_KEY`.
- **Compatible con OpenAI** sirve para OpenAI, DeepSeek, OpenRouter, Groq, LM Studio, vLLM, llama.cpp…
  (p. ej. `https://api.deepseek.com/beta`, `https://openrouter.ai/api/v1`, `http://localhost:1234/v1`).

### Las herramientas necesitan un modelo «instruct»

Los modelos *base* del autocompletado no siguen instrucciones. Para documentar, arreglar, explicar, Rename,
Prompt y Halo IA, GhostCode usa un modelo *instruct* (por ejemplo `qwen2.5-coder:3b`). Si no tienes ninguno, te
ofrece descargarlo; también puedes hacerlo desde la pestaña **Modelos**. En modo API se usa tu proveedor.

---

## Ajustes

| Ajuste | Por defecto | |
|---|---|---|
| `ghostcode.mode` | `local` | `local` / `api` / `off` |
| `ghostcode.local.model` | `qwen2.5-coder:1.5b-base` | modelo de autocompletado (*base*, con FIM) |
| `ghostcode.local.chatModel` | (automático) | modelo *instruct* para las herramientas |
| `ghostcode.local.url` | `http://localhost:11434` | puede ser un Ollama en otra máquina de tu red |
| `ghostcode.api.provider` | `anthropic` | `anthropic` / `codestral` / `openai-compatible` |
| `ghostcode.api.model` / `ghostcode.api.baseUrl` | (los del proveedor) | |
| `ghostcode.hoverExplain` | `true` | explicar funciones, clases, SQL y regex al pasar el puntero |
| `ghostcode.projectContext` | `true` | añadir la API real del proyecto al autocompletado |
| `ghostcode.pathCheck` | `true` | marcar las rutas que no existen |
| `ghostcode.fixPreview` | `true` | ver el arreglo propuesto antes de aplicarlo |
| `ghostcode.indentSize` | `0` | espacios por nivel al corregir la indentación (0 = los del editor) |
| `ghostcode.halo.enabled` | `true` | usar lo aprendido por Halo IA al escribir |
| `ghostcode.promptsFile` | `PROMPTS.md` | archivo donde se guardan los prompts |
| `ghostcode.annotationLanguage` | `auto` | idioma de documentación y explicaciones |
| `ghostcode.multiline` | `auto` | `auto` / `always` / `never` |
| `ghostcode.disabledLanguages` | `plaintext, markdown, …` | lenguajes donde no se sugiere |

## Solución de problemas

- **No aparecen sugerencias**: revisa que el interruptor del panel esté activo, que `editor.inlineSuggest.enabled`
  sea `true` y que no haya otra extensión de autocompletado activa.
- **«Ollama no responde»**: inícialo con `systemctl start ollama` (o `ollama serve`).
- **GPU AMD sin usar** (el modelo va por CPU): `sudo systemctl edit ollama` y añade
  `Environment="OLLAMA_VULKAN=1"` en `[Service]`; luego `sudo systemctl restart ollama`.
- **Las sugerencias tardan**: usa un modelo más pequeño en la pestaña **Modelos**.
- **Registro**: `Ctrl+Shift+P` → «GhostCode: Ver registro».

---

## Desarrollo

```bash
npm ci
npm test                       # pruebas unitarias
npm run test:vscode            # pruebas en una instancia aislada de VS Code (necesita Ollama)
npm run test:project -- <ruta> # prueba sobre un proyecto real, sin modificarlo
npm run watch                  # y F5 en VS Code para abrir una ventana de prueba
npm run release                # genera .vsix, .deb y .tar.gz en releases/
```

## Licencia

[MIT](LICENSE).

---

Creado por [GMR027](https://github.com/GMR027).

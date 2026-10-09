// Vista lateral de GhostCode. El estado lo envía src/panel.ts; aquí solo se pinta y se reenvían los clics.
// @ts-check
/* global acquireVsCodeApi */
const vscode = acquireVsCodeApi();
const app = /** @type {HTMLElement} */ (document.getElementById("app"));
/** @type {{ closed: Record<string, boolean>, tab?: string }} */
const saved = vscode.getState() || { closed: {} };
/** @type {any} */
let state;

window.addEventListener("message", (e) => {
  if (e.data?.type === "state") {
    state = e.data.state;
    render();
  }
});

app.addEventListener("click", (e) => {
  const el = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest("[data-action]"));
  if (!el || /** @type {HTMLButtonElement} */ (el).disabled) return;
  // Un botón dentro del <summary> no debe plegar la sección; un enlace no navega dentro del panel.
  if (el.closest("summary") || el.tagName === "A") e.preventDefault();
  if (el.dataset.action === "tab") {
    saved.tab = el.dataset.tab;
    vscode.setState(saved);
    render();
    app.querySelector(".tabs")?.scrollIntoView({ block: "nearest" });
    return;
  }
  const { action, with: withId, ...data } = el.dataset;
  // Botones que envían el valor de un campo (p. ej. «Analizar» con la ruta escrita).
  if (withId) data.value = /** @type {HTMLInputElement} */ (document.getElementById(withId))?.value ?? "";
  vscode.postMessage({ type: action, ...data });
});

/** Lo escrito en los campos: se conserva aunque el panel se vuelva a pintar. */
/** @type {Record<string, string>} */
const drafts = {};
app.addEventListener("input", (e) => {
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (el.id) drafts[el.id] = el.value;
});
app.addEventListener("keydown", (e) => {
  // Enter en el campo de Halo IA = Analizar.
  const el = /** @type {HTMLInputElement} */ (e.target);
  if (e.key === "Enter" && el.id === "haloInput" && el.value.trim()) vscode.postMessage({ type: "haloAnalyze", value: el.value });
});

app.addEventListener("change", (e) => {
  const el = /** @type {HTMLSelectElement} */ (e.target);
  if (el.dataset.change) vscode.postMessage({ type: el.dataset.change, name: el.value, value: el.value });
});

// Recordar qué secciones están plegadas ("toggle" no burbujea: se escucha en captura).
document.addEventListener(
  "toggle",
  (e) => {
    const d = /** @type {HTMLDetailsElement} */ (e.target);
    if (!d.dataset.id) return;
    saved.closed[d.dataset.id] = !d.open;
    vscode.setState(saved);
  },
  true,
);

vscode.postMessage({ type: "ready" });

// --- Iconos (SVG en línea, trazo fino con el color del texto) ------------------------
const PATHS = {
  ghost: '<path d="M5 21V10a7 7 0 0 1 14 0v11l-2.33-1.75L14.33 21 12 19.25 9.67 21l-2.34-1.75z"/><circle cx="9.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".9" fill="currentColor"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.5 4.25 4.25 0 0 0 7 18z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L3 9M3 4v5h5M4 13a8 8 0 0 0 14.6 4.5L21 15M21 20v-5h-5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  indent: '<path d="M3 5h18M10 10h11M10 14h11M3 19h18M3 9.5l3 2.5-3 2.5"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  pointer: '<path d="M5 3l14 7-6 2-2 6z"/><path d="M13 12l5 5"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8M8 10.5h5"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  layers: '<path d="M12 3 2 8.5l10 5.5 10-5.5z"/><path d="M2 13.5 12 19l10-5.5"/>',
  gpu: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="8" cy="12" r="2.2"/><circle cx="16" cy="12" r="2.2"/><path d="M6 17v3M10 17v3"/>',
  ram: '<rect x="2" y="7" width="20" height="9" rx="1.5"/><path d="M6 16v3M10 16v3M14 16v3M18 16v3M6 10.5h2M11 10.5h2M16 10.5h2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8"/>',
  repo: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H9M13 21h6v-3M9 18v5l2-1.5 2 1.5v-5"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-6 4-11.2 8.8"/>',
  diff: '<path d="M6 3v12M3 9h6M15 21V9M12 15h6M18 3h-6M6 21h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  halo: '<circle cx="12" cy="12" r="3.2"/><ellipse cx="12" cy="12" rx="9.5" ry="4.2" transform="rotate(-25 12 12)"/>',
  prompt: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  puzzle: '<path d="M9 3h6v3a2 2 0 1 0 4 0h2v6h-3a2 2 0 1 0 0 4h3v5h-6v-3a2 2 0 1 0-4 0v3H5v-6h3a2 2 0 1 0 0-4H5V3z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  filePlus: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
};
/** @param {keyof typeof PATHS} name */
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;

/** @param {unknown} s */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Interruptor accesible. @param {boolean} on @param {string} action @param {string} label */
const toggle = (on, action, label) =>
  `<button class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" title="${esc(label)}" data-action="${action}"><span></span></button>`;

/**
 * Una sección: tarjeta con su color (data-hue), icono, título y para qué sirve.
 * @param {string} hue @param {keyof typeof PATHS} ico @param {string} title @param {string} subtitle @param {string} body @param {string} [extra]
 */
function section(hue, ico, title, subtitle, body, extra = "") {
  return `<section class="block" data-hue="${hue}">
    <header class="block-head">
      <span class="block-icon">${icon(ico)}</span>
      <span class="grow"><h2>${title}</h2><p>${subtitle}</p></span>
      ${extra}
    </header>
    <div class="body">${body}</div>
  </section>`;
}

/** Subgrupo dentro de una sección. @param {string} label @param {string} body */
const group = (label, body) => `<div class="group"><p class="group-label">${label}</p>${body}</div>`;

const TABS = [
  { id: "tools", ico: /** @type {const} */ ("sparkle"), label: "Herramientas" },
  { id: "ai", ico: /** @type {const} */ ("halo"), label: "IA" },
  { id: "project", ico: /** @type {const} */ ("repo"), label: "Proyecto" },
  { id: "models", ico: /** @type {const} */ ("cpu"), label: "Modelos" },
];

function tabs(s) {
  const badge = { tools: s.pathIssues || 0, project: s.git?.status === "repo" ? s.git.changes || 0 : 0 };
  return `<nav class="tabs" role="tablist" aria-label="Secciones de GhostCode">${TABS.map((t) => {
    const n = /** @type {Record<string, number>} */ (badge)[t.id];
    return `<button class="tab" role="tab" aria-selected="${current() === t.id}" data-action="tab" data-tab="${t.id}" data-hue="${t.id}">
      ${icon(t.ico)}<span>${t.label}</span>${n ? `<span class="tab-badge" title="${t.id === "tools" ? "Rutas rotas" : "Cambios sin confirmar"}">${n > 99 ? "99+" : n}</span>` : ""}
    </button>`;
  }).join("")}</nav>`;
}

const current = () => (TABS.some((t) => t.id === saved.tab) ? saved.tab : "tools");

function footer(s) {
  return `<footer class="credits">
    ${icon("ghost")}<span>GhostCode${s.version ? ` v${esc(s.version)}` : ""} · Creado por
    <a href="#" data-action="openUrl" data-url="https://github.com/GMR027" title="https://github.com/GMR027">GMR027</a></span>
  </footer>`;
}

/**
 * El fantasma del panel es un nodo persistente: así su animación de entrada no se
 * reinicia cada vez que el panel se vuelve a pintar.
 */
const logo = document.createElement("div");
logo.className = "logo intro";
logo.setAttribute("aria-hidden", "true");
logo.innerHTML = `<svg class="icon ghost" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 21V10a7 7 0 0 1 14 0v11l-2.33-1.75L14.33 21 12 19.25 9.67 21l-2.34-1.75z"/>
  <g class="eyes"><circle cx="9.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".9" fill="currentColor"/></g>
</svg>`;
// Pasado el saludo inicial, solo se anima al pasar el puntero.
setTimeout(() => logo.classList.remove("intro"), 6000);

let lastPrompt = "";

function render() {
  const s = state;
  // Un prompt nuevo reemplaza lo que se hubiera editado del anterior.
  if (s.prompt?.text !== lastPrompt) {
    lastPrompt = s.prompt?.text ?? "";
    delete drafts.promptText;
  }
  const focused = /** @type {HTMLInputElement | null} */ (document.activeElement);
  const focus = focused?.id ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : undefined;
  const content = {
    tools: () => toolsSection(s),
    ai: () => haloSection(s) + promptSection(s),
    project: () => gitSection(s) + extensionsSection(s),
    models: () => modelsSection(s),
  }[current()]();
  app.innerHTML = header(s) + tabs(s) + `<main class="tab-panel" role="tabpanel">${content}</main>` + footer(s);
  app.querySelector(".logo-slot")?.replaceWith(logo);
  for (const [id, value] of Object.entries(drafts)) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.value = value;
  }
  if (focus) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(focus.id));
    el?.focus();
    if (el && focus.start !== null) el.setSelectionRange(focus.start, focus.end);
  }
}

// --- Cabecera: estado + modo -------------------------------------------------------
function header(s) {
  const status = s.enabled ? (s.ollamaError && s.mode === "local" ? "warn" : "on") : "off";
  const statusText = { on: "Activo", off: "En pausa", warn: "Sin conexión con Ollama" }[status];
  const detail = s.enabled ? s.backendLabel.replace(/^(Local|API|Claude|Codestral) · /, "") : "El autocompletado está desactivado";
  const modes = [
    ["local", "cpu", "Local", "En tu equipo"],
    ["api", "cloud", "API", "En la nube"],
  ]
    .map(
      ([m, ico, label, sub]) => `<button class="mode" role="radio" aria-checked="${s.mode === m}" data-action="mode" data-mode="${m}">
        ${icon(/** @type {any} */ (ico))}<span><strong>${label}</strong><small>${sub}</small></span></button>`,
    )
    .join("");
  return `<header class="hero ${status}">
    <div class="brand">
      <div class="logo-slot"></div>
      <div class="grow">
        <h1>GhostCode</h1>
        <p class="status"><span class="dot"></span>${statusText}</p>
        <p class="detail" title="${esc(detail)}">${esc(detail)}</p>
      </div>
      ${toggle(s.enabled, "toggle", s.enabled ? "Desactivar autocompletado" : "Activar autocompletado")}
    </div>
    <div class="modes" role="radiogroup" aria-label="Origen de las sugerencias">${modes}</div>
    ${s.mode === "api" ? `<button class="link" data-action="configureApi">${icon("settings")}<span>${esc(s.apiLabel)}</span></button>` : ""}
  </header>`;
}

// --- Herramientas -------------------------------------------------------------------
function toolsSection(s) {
  /** @param {keyof typeof PATHS} ico @param {string} title @param {string} desc @param {string} action */
  const tile = (ico, title, desc, action) =>
    `<button class="tile" data-action="${action}">
      <span class="tile-icon">${icon(ico)}</span>
      <span class="grow"><strong>${title}</strong><small>${desc}</small></span>
    </button>`;
  /** @param {keyof typeof PATHS} ico @param {string} title @param {string} desc @param {boolean} on @param {string} action */
  const option = (ico, title, desc, on, action) =>
    `<div class="tile">
      <span class="tile-icon">${icon(ico)}</span>
      <span class="grow"><strong>${title}</strong><small>${desc}</small></span>
      ${toggle(on, action, `${on ? "Desactivar" : "Activar"}: ${title}`)}
    </div>`;
  let model = "";
  if (s.mode === "api") model = `<p class="muted">Las herramientas usan ${esc(s.apiLabel)}.</p>`;
  else if (s.installed) {
    const instruct = s.installed.filter((m) => !m.base);
    const auto = s.chatAuto ? `Automático (${esc(s.chatAuto)})` : "Automático (no hay modelo instruct)";
    model = `<label class="field"><span>Modelo para las herramientas</span>
      <select data-change="useChatModel">
        <option value="" ${s.chatModel ? "" : "selected"}>${auto}</option>
        ${instruct.map((m) => `<option value="${esc(m.name)}" ${m.name === s.chatModel ? "selected" : ""}>${esc(m.name)}</option>`).join("")}
      </select></label>`;
  }
  const indexed = s.indexedFiles ? `${s.indexedFiles} archivos indexados` : "Indexando el proyecto…";
  const issues = s.pathIssues ? `${s.pathIssues} ruta(s) rota(s) encontradas` : "Revisa href, src, import, require, include…";
  return section(
    "tools",
    "sparkle",
    "Herramientas",
    "Trabajan sobre el archivo abierto: pon el cursor o selecciona código",
    group(
      "Escribir y entender",
      `<div class="tiles">
        ${tile("book", "Documentar función", "Genera la documentación de la función bajo el cursor", "document")}
        ${tile("tag", "Rename", "Sugiere un nombre según lo que hace la función seleccionada", "rename")}
        ${tile("comment", "Anotar selección", "Inserta un comentario que explica el código", "annotate")}
      </div>`,
    ) +
      group(
        "Revisar y corregir",
        `<div class="tiles">
        ${tile("bulb", "Arreglar error con IA", "Propone un arreglo para el error más cercano", "fix")}
        <div class="tile column">
          <div class="tile-row">
            <span class="tile-icon">${icon("route")}</span>
            <span class="grow"><strong>Corrección de rutas</strong><small>${issues}</small></span>
          </div>
          <div class="row-btns">
            <button class="btn ghost" data-action="checkPaths">${icon("file")}Este archivo</button>
            <button class="btn ghost" data-action="checkProjectPaths">${icon("folder")}Todo el proyecto</button>
          </div>
          <button class="btn ${s.brokenShown ? "ghost" : ""} wide" data-action="${s.brokenShown ? "hideBroken" : "showBroken"}" ${s.brokenBusy ? "disabled" : ""}>
            ${icon("warning")}${s.brokenBusy ? "Revisando el proyecto…" : s.brokenShown ? "Ocultar rutas rotas" : "Mostrar rutas rota(s)"}
          </button>
          ${s.brokenShown && !s.brokenBusy ? brokenList(s.brokenPaths ?? []) : ""}
        </div>
        <div class="tile column">
          <div class="tile-row">
            <span class="tile-icon">${icon("indent")}</span>
            <span class="grow"><strong>Corregir indentación</strong><small>De la selección o del archivo completo</small></span>
          </div>
          <div class="row-btns">
            <label class="inline-field" title="Espacios por nivel (vacío = los del editor)">Espacios
              <input id="indentSpaces" type="number" min="0" max="16" value="${s.indentSize || ""}" placeholder="auto" data-change="indentSize">
            </label>
            <button class="btn ghost" data-action="indent" data-with="indentSpaces">${icon("indent")}Corregir</button>
          </div>
        </div>
      </div>`,
      ) +
      group(
        "Automático",
        `<div class="tiles">
        ${option("pointer", "Explicar al pasar el puntero", "Funciones, clases, SQL y expresiones regulares", s.hoverExplain, "toggleHover")}
        ${option("layers", "Contexto del proyecto", s.projectContext ? indexed : "Desactivado", s.projectContext, "toggleProjectContext")}
        ${option("route", "Vigilar rutas al escribir", "Marca las rutas que no existen", s.pathCheck, "togglePathCheck")}
      </div>
      ${model}`,
      ),
  );
}

/** Rutas rotas agrupadas por archivo, con «Ir» y «Corregir». */
function brokenList(list) {
  if (!list.length) return `<p class="ok-line">${icon("check")}No hay rutas rotas en el proyecto.</p>`;
  const byFile = new Map();
  for (const b of list) byFile.set(b.file, [...(byFile.get(b.file) ?? []), b]);
  return `<div class="broken" role="list">${[...byFile.entries()]
    .map(
      ([file, items]) => `<div class="broken-file">
        <p class="broken-name">${icon("file")}<span>${esc(file)}</span><span class="count">${items.length}</span></p>
        ${items
          .map((b) => {
            const at = `data-uri="${esc(b.uri)}" data-line="${b.line}" data-start="${b.start}" data-end="${b.end}"`;
            return `<div class="broken-item" role="listitem">
              <button class="broken-where" data-action="openBroken" ${at} title="Abrir en la línea ${b.line + 1}">
                <span class="ln">${b.line + 1}</span><code class="bad">${esc(b.value)}</code>
              </button>
              ${
                b.suggestion
                  ? `<button class="broken-fix" data-action="fixBroken" ${at} data-value="${esc(b.suggestion)}" title="Reemplazar por ${esc(b.suggestion)}">
                      → <code>${esc(b.suggestion)}</code><span class="fix-label">Corregir</span></button>`
                  : `<span class="muted nofix">sin sugerencia</span>`
              }
            </div>`;
          })
          .join("")}
      </div>`,
    )
    .join("")}</div>`;
}

// --- Halo IA ------------------------------------------------------------------------
function haloSection(s) {
  const sources = (s.halo ?? [])
    .map(
      (h) => `<article class="card">
        <div class="card-top">
          <span class="name">${esc(h.name)}</span>
          <button class="icon-btn" data-action="haloRemove" data-id="${esc(h.id)}" title="Quitar de la caché" aria-label="Quitar ${esc(h.name)}">${icon("close")}</button>
        </div>
        <span class="meta"><span>${h.files} archivos · ${h.functions} funciones${h.cloned ? " · repositorio clonado" : ""}</span></span>
        <div class="tags">${h.tags.map((t) => `<span class="chip plain">${esc(t)}</span>`).join("")}</div>
        ${
          h.summary
            ? `<details class="learned"><summary>Lo que aprendió de tu código</summary><ul>${h.summary
                .split("\n")
                .map((l) => `<li>${esc(l.replace(/^[-*•]\s*/, ""))}</li>`)
                .join("")}</ul></details>`
            : `<p class="muted">Sin resumen del modelo (se usa el estilo medido).</p>`
        }
      </article>`,
    )
    .join("");
  return section(
    "halo",
    "halo",
    "Halo IA",
    "Aprende cómo escribes para sugerirte código a tu estilo",
    `<p class="muted">Ingresa un repositorio o la ruta de la carpeta de un proyecto para que el modelo de IA (local o API) analice el código.
      El análisis se guarda en una caché temporal mientras VS Code esté abierto (usa «Guardar temporal» para conservarlo entre sesiones) y se usa al escribir como referencia de cómo escribes.</p>
    <div class="input-row">
      <input id="haloInput" type="text" placeholder="~/proyectos/mi-app  o  https://github.com/usuario/repo" aria-label="Ruta o repositorio">
      <button class="btn" data-action="haloAnalyze" data-with="haloInput">Analizar</button>
    </div>
    <div class="row-btns">
      <button class="btn ghost" data-action="haloSave" title="Conserva el análisis al cerrar y reabrir VS Code">${icon("save")}Guardar temporal</button>
      <button class="btn ghost" data-action="haloClear" title="Borra el análisis, también el guardado">${icon("close")}Limpiar</button>
    </div>
    ${s.haloPersisted ? `<p class="muted">Análisis guardado: se conservará al reabrir VS Code hasta que pulses «Limpiar».</p>` : ""}
    <div class="row-btns">
      <button class="btn ghost" data-action="haloBrowse">${icon("folder")}Elegir carpeta…</button>
      <button class="btn ghost" data-action="haloWorkspace">${icon("repo")}Proyecto abierto</button>
    </div>
    ${sources ? `<div class="cards">${sources}</div>` : ""}
    ${
      s.halo?.length
        ? `<div class="tiles"><div class="tile"><span class="grow"><strong>Usar al escribir</strong><small>Autocompletado y herramientas imitan tu estilo</small></span>${toggle(s.haloEnabled, "toggleHalo", "Usar Halo IA")}</div></div>`
        : ""
    }`,
  );
}

// --- Prompts ------------------------------------------------------------------------
function promptSection(s) {
  const p = s.prompt;
  return section(
    "prompt",
    "prompt",
    "Prompt",
    "Convierte tu código en prompts para reutilizarlo en otros proyectos",
    `<button class="btn wide" data-action="prompt" ${s.promptBusy ? "disabled" : ""}>${icon("sparkle")}${s.promptBusy ? "Generando…" : "Crear prompt del código seleccionado"}</button>
    ${
      p
        ? `<label class="field"><span>Prompt de <code>${esc(p.source)}</code> (puedes editarlo)</span>
            <textarea id="promptText" rows="10" spellcheck="false">${esc(p.text)}</textarea></label>
          <div class="row-btns">
            <button class="btn ghost" data-action="copyPrompt" data-with="promptText">${icon("copy")}Copiar</button>
            <button class="btn ghost" data-action="savePrompt" data-with="promptText">${icon("filePlus")}Crear md-prompt</button>
          </div>
          <p class="muted">«Crear md-prompt» lo añade a <code>${esc(s.promptsFile)}</code> junto con los anteriores.</p>`
        : `<p class="muted">Selecciona código en el editor y crea un prompt reutilizable para pedir algo equivalente en otro proyecto.</p>`
    }
    <div class="tiles">
      <button class="tile" data-action="projectContext">
        <span class="tile-icon">${icon("book")}</span>
        <span class="grow"><strong>Prompt y contexto del proyecto</strong><small>Crea PROJECT-CONTEXT.md: de qué trata, objetivo, lenguajes, herramientas, frontend y backend</small></span>
      </button>
    </div>`,
  );
}

// --- Extensiones recomendadas ---------------------------------------------------------
function extensionsSection(s) {
  const e = s.extensions ?? { recs: [], languages: [] };
  const row = (r) => `<div class="tile">
      <span class="grow"><strong>${esc(r.name)}</strong><small>${esc(r.why)}</small><small class="because">${esc(r.because)}</small></span>
      ${
        r.installed
          ? `<span class="state">${icon("check")}Instalada</span>`
          : `<button class="btn ghost" data-action="installExt" data-id="${esc(r.id)}" title="${esc(r.id)}">${icon("download")}Instalar</button>`
      }
    </div>`;
  const missing = e.recs.filter((r) => !r.installed);
  const done = e.recs.filter((r) => r.installed);
  let body;
  if (!e.recs.length) body = `<p class="muted">Abre un proyecto para ver recomendaciones.</p>`;
  else {
    body = `<p class="muted">Lenguajes detectados: ${esc(e.languages.join(", ") || "—")}</p>
      ${missing.length ? `<div class="tiles">${missing.map(row).join("")}</div>` : `<p class="muted">Ya tienes todas las recomendadas.</p>`}
      ${done.length ? `<details class="learned"><summary>Ya instaladas (${done.length})</summary><div class="tiles">${done.map(row).join("")}</div></details>` : ""}`;
  }
  return section(
    "extensions",
    "puzzle",
    "Extensiones recomendadas",
    "Según los lenguajes y herramientas de este proyecto",
    body,
    `<button class="icon-btn" data-action="refreshExtensions" title="Volver a analizar" aria-label="Volver a analizar">${icon("refresh")}</button>`,
  );
}

// --- Conexión GitHub ----------------------------------------------------------------
function gitSection(s) {
  const g = s.git ?? { status: "no-folder" };
  let body;
  if (g.status === "no-folder") {
    body = `<div class="empty">${icon("repo")}<strong>No hay ninguna carpeta abierta</strong>Abre un proyecto para ver su repositorio.</div>`;
  } else if (g.status === "unavailable") {
    body = `<div class="empty">${icon("repo")}<strong>Git no está disponible</strong>Activa la extensión Git de VS Code (ajuste <code>git.enabled</code>).</div>`;
  } else if (g.status === "no-repo") {
    body = `<div class="empty">${icon("repo")}<strong>No está conectado a un repositorio</strong>
      La carpeta «${esc(g.folder)}» no usa Git, así que no hay rama ni repositorio remoto.
      <button class="btn ghost" data-action="gitInit">${icon("plus")}Inicializar repositorio</button></div>`;
  } else {
    const remote = g.remote
      ? g.remote.web
        ? `<button class="value" data-action="openRemote" title="${esc(g.remote.url)}">${esc(g.remote.host)}/${esc(g.remote.owner)}/${esc(g.remote.repo)}</button>`
        : `<span class="value mono" title="${esc(g.remote.url)}">${esc(g.remote.url)}</span>`
      : `<span class="value muted">Sin repositorio remoto</span>`;
    const sync = [g.ahead ? `↑${g.ahead}` : "", g.behind ? `↓${g.behind}` : ""].filter(Boolean).join(" ");
    const changes = g.changes ? `${g.changes} ${g.changes === 1 ? "archivo" : "archivos"}${g.staged ? ` · ${g.staged} preparados` : ""}` : "Sin cambios";
    body = `<div class="facts">
        <div class="fact">${icon("repo")}<span class="label">Repositorio</span><span class="value">${esc(g.name)}</span></div>
        <div class="fact">${icon("branch")}<span class="label">Rama</span><span class="value mono">${esc(g.branch ?? "—")}${g.hasCommits ? "" : `<span class="sync">sin commits</span>`}${sync ? `<span class="sync">${sync}</span>` : ""}</span></div>
        <div class="fact">${icon("diff")}<span class="label">Cambios</span><button class="value" data-action="openScm" style="color:inherit">${changes}</button></div>
        <div class="fact">${icon("globe")}<span class="label">Remoto</span>${remote}</div>
      </div>
      <button class="btn wide" data-action="commit" ${g.changes ? "" : "disabled"}>${icon("sparkle")}Generar mensaje de commit</button>
      ${
        !g.remote
          ? `<button class="btn ghost wide" data-action="publish">${icon("upload")}Publicar en GitHub</button>`
          : g.remote.isGitHub
            ? ""
            : `<p class="muted">El remoto no es GitHub (${esc(g.remote.host)}).</p>`
      }`;
  }
  return section("git", "branch", "Conexión GitHub", "Repositorio, rama y mensajes de commit", body);
}

function ollamaDown(s) {
  return `<div class="notice">${icon("warning")}<div>
      <strong>${esc(s.ollamaError)}</strong>
      <p>Inícialo con <code>systemctl start ollama</code> u <code>ollama serve</code>.</p>
      <button class="btn ghost" data-action="refresh">${icon("refresh")}Reintentar</button>
    </div></div>`;
}

/** @param {boolean} completion */
const kindChip = (completion) =>
  completion ? `<span class="chip completion">Autocompletado</span>` : `<span class="chip chat">Herramientas</span>`;

// --- Modelos (instalados y sugeridos) ---------------------------------------------------
function modelsSection(s) {
  let installed;
  if (s.ollamaError) installed = ollamaDown(s);
  else if (!s.installed) installed = `<p class="muted">Buscando modelos…</p>`;
  else if (!s.installed.length) installed = `<div class="empty">${icon("box")}<strong>No hay modelos instalados</strong>Descarga uno de los sugeridos, aquí abajo.</div>`;
  else {
    installed = `<div class="models" role="radiogroup" aria-label="Modelo de autocompletado">${s.installed
      .map((m) => {
        const active = m.name === s.localModel;
        return `<button class="model ${active ? "active" : ""}" role="radio" aria-checked="${active}" data-action="useModel" data-name="${esc(m.name)}" ${active ? "disabled" : ""}>
          <span class="radio"></span>
          <span class="grow"><span class="name">${esc(m.name)}</span><span class="meta">${kindChip(m.base)}<span>${m.sizeGb} GB</span></span></span>
          ${active ? `<span class="state">${icon("check")}En uso</span>` : ""}
        </button>`;
      })
      .join("")}</div>`;
    if (!s.installed.some((m) => m.name === s.localModel)) {
      installed += `<div class="notice">${icon("warning")}<div>El modelo configurado (<code>${esc(s.localModel)}</code>) no está instalado.</div></div>`;
    }
  }

  const gpu = s.hw.vramGb ? `${s.hw.gpu ?? "GPU"} · ${s.hw.vramGb} GB VRAM` : "Sin GPU dedicada";
  const hw = `<div class="hw" title="Las sugerencias se basan en este hardware">
    <span class="hw-item">${icon("gpu")}${esc(gpu)}</span>
    <span class="hw-item">${icon("ram")}${s.hw.ramGb} GB RAM</span>
  </div>`;
  const cards = s.suggestions
    .map((m) => {
      let action;
      if (m.active) action = `<span class="state">${icon("check")}En uso</span>`;
      else if (m.pulling !== undefined) action = "";
      else if (m.installed) {
        action = `<button class="btn ghost" data-action="${m.use === "chat" ? "useChatModel" : "useModel"}" data-name="${esc(m.name)}">Usar</button>`;
      } else {
        action = `<button class="btn ghost" data-action="pull" data-name="${esc(m.name)}" ${s.ollamaError ? "disabled" : ""}>${icon("download")}Descargar</button>`;
      }
      const progress =
        m.pulling !== undefined
          ? `<div class="progress" role="progressbar" aria-valuenow="${m.pulling}" aria-valuemin="0" aria-valuemax="100" aria-label="Descargando ${esc(m.name)}">
              <span style="width:${m.pulling}%"></span></div><span class="muted">Descargando… ${m.pulling}%</span>`
          : "";
      return `<article class="card">
        <div class="card-top">
          <span class="name">${esc(m.name)}</span>
          ${m.recommended ? `<span class="recommended-label">${icon("star")}Recomendado</span>` : ""}
        </div>
        <p class="note">${esc(m.note)}</p>
        <div class="card-bottom">
          <span class="meta">${kindChip(m.use === "completion")}<span>${m.sizeGb} GB</span></span>
          ${action}
        </div>
        ${progress}
      </article>`;
    })
    .join("");

  return section(
    "models",
    "cpu",
    "Modelos",
    "Los que tienes en Ollama y los recomendados para tu equipo",
    group("Instalados en Ollama", installed) + group("Sugeridos para tu equipo", `${hw}<div class="cards">${cards}</div>`),
    `<button class="icon-btn" data-action="refresh" title="Actualizar lista" aria-label="Actualizar lista">${icon("refresh")}</button>`,
  );
}

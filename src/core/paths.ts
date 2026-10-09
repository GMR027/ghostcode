import { posix } from "node:path";

/**
 * «Corrección de rutas»: encuentra rutas a archivos del proyecto escritas en el código
 * (href, src, import, require, include, url()…), comprueba que existan y propone la
 * ruta correcta. Todo por texto, para cualquier lenguaje.
 */

export type RefKind = "link" | "asset" | "import" | "include" | "sass" | "ruby";

export interface PathRef {
  /** La ruta tal como está escrita. */
  value: string;
  /** Posición del valor dentro de la línea. */
  start: number;
  end: number;
  kind: RefKind;
  /** PHP: `__DIR__ . '/…'` (relativa a la carpeta del archivo, empieza por /). */
  viaDir?: boolean;
}

const ATTR_RE = /\b(href|src|action|poster|data-src)\s*=\s*(["'])([^"'\n]*)\2/gi;
const CSS_URL_RE = /url\(\s*(["']?)([^"')\s]+)\1\s*\)/g;
const CSS_IMPORT_RE = /@(?:import|use|forward)\s+(["'])([^"']+)\1/g;
const JS_IMPORT_RE = /\b(?:import|export)\s+(?:[^'"`;]*?\sfrom\s*)?(["'])([^"'\n]+)\1/g;
const JS_CALL_RE = /\b(?:import|require)\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const PHP_INCLUDE_RE = /\b(?:include|include_once|require|require_once)\b\s*\(?\s*((?:__DIR__|dirname\(\s*__FILE__\s*\))\s*\.\s*)?(["'])([^"'\n]+)\2/g;
const C_INCLUDE_RE = /^\s*#\s*include\s*"([^"]+)"/;
const MD_LINK_RE = /!?\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const RUBY_RE = /\brequire_relative\s*\(?\s*(["'])([^"']+)\1/g;

const MARKUP = new Set(["html", "php", "vue", "svelte", "javascriptreact", "typescriptreact", "blade", "twig", "erb", "handlebars", "razor", "astro", "jinja", "django-html"]);
const STYLES = new Set(["css", "scss", "sass", "less", "stylus"]);
const SCRIPTS = new Set(["javascript", "typescript", "javascriptreact", "typescriptreact", "vue", "svelte", "astro"]);

export function supportsPaths(languageId: string): boolean {
  return MARKUP.has(languageId) || STYLES.has(languageId) || SCRIPTS.has(languageId) ||
    ["php", "markdown", "c", "cpp", "ruby", "objective-c"].includes(languageId);
}

/** Valores que no son rutas de archivos del proyecto: URLs, anclas, plantillas, paquetes… */
export function isCheckable(value: string, kind: RefKind): boolean {
  if (!value.trim() || /^(?:[a-z][\w+.-]*:|\/\/|#|\?)/i.test(value)) return false; // http:, mailto:, data:, //cdn, #id, ?q
  if (/[{}$*%<>`]|\{\{|<\?/.test(value)) return false; // plantillas e interpolaciones
  if ((kind === "import" || kind === "sass") && !/^[./]/.test(value) && kind === "import") return false; // paquete npm
  if (kind === "sass" && /^(sass|~)/.test(value)) return false; // módulos de Sass (sass:math)
  return true;
}

/** Rutas escritas en una línea. */
export function findPathRefs(line: string, languageId: string): PathRef[] {
  const out: PathRef[] = [];
  const push = (value: string, index: number, kind: RefKind, viaDir = false) => {
    if (isCheckable(value, kind)) out.push({ value, start: index, end: index + value.length, kind, viaDir });
  };
  const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) fn(m);
  };
  if (MARKUP.has(languageId) || languageId === "markdown") {
    each(ATTR_RE, (m) => push(m[3], m.index + m[0].length - 1 - m[3].length, /^(href|action)$/i.test(m[1]) ? "link" : "asset"));
  }
  if (STYLES.has(languageId) || MARKUP.has(languageId)) {
    each(CSS_URL_RE, (m) => push(m[2], m.index + m[0].indexOf(m[2]), "asset"));
  }
  if (STYLES.has(languageId)) each(CSS_IMPORT_RE, (m) => push(m[2], m.index + m[0].indexOf(m[2], m[0].indexOf(m[1])), "sass"));
  if (SCRIPTS.has(languageId)) {
    each(JS_IMPORT_RE, (m) => push(m[2], m.index + m[0].lastIndexOf(m[2]), "import"));
    each(JS_CALL_RE, (m) => push(m[2], m.index + m[0].lastIndexOf(m[2]), "import"));
  }
  if (languageId === "php") each(PHP_INCLUDE_RE, (m) => push(m[3], m.index + m[0].lastIndexOf(m[3]), "include", Boolean(m[1])));
  if (languageId === "c" || languageId === "cpp" || languageId === "objective-c") {
    const m = C_INCLUDE_RE.exec(line);
    if (m) push(m[1], line.indexOf(`"${m[1]}"`) + 1, "include");
  }
  if (languageId === "markdown") each(MD_LINK_RE, (m) => push(m[1], m.index + m[0].lastIndexOf(m[1]), "link"));
  if (languageId === "ruby") each(RUBY_RE, (m) => push(m[2], m.index + m[0].lastIndexOf(m[2]), "ruby"));
  // Sin duplicados (un mismo valor puede coincidir con dos reglas).
  return out.filter((r, i) => out.findIndex((o) => o.start === r.start) === i);
}

// --- Rutas del enrutador (no son archivos) ------------------------------------------------

const ROUTE_RES = [
  /(?:->|::|\.)\s*(?:get|post|put|patch|delete|options|any|match|route|all)\s*\(\s*(["'])(\/[^"'\n]*)\1/gi, // PHP, Express, Laravel
  /@\w+(?:\.\w+)*\.(?:route|get|post|put|delete|patch)\(\s*(["'])(\/[^"'\n]*)\1/g, // Flask, FastAPI
  /\b(?:re_)?path\(\s*(["'])([^"'\n]*)\1/g, // Django
  /^\s*(?:get|post|put|patch|delete|match)\s+(["'])(\/[^"'\n]*)\1/gm, // Rails, Sinatra
];

/** Rutas definidas en el código de un archivo (enrutadores de PHP, Express, Flask, Django, Rails…). */
export function extractRoutes(text: string): string[] {
  const out = new Set<string>();
  for (const re of ROUTE_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) out.add(("/" + m[2].replace(/^\^/, "").replace(/\$$/, "")).replace(/\/{2,}/g, "/"));
  }
  return [...out];
}

function routeRegex(route: string): RegExp {
  const pattern = route
    .replace(/\/+$/, "")
    .split(/(:\w+\??|\{[^}]+\}|<[^>]+>|\[[^\]]+\]|\*)/)
    .map((part, i) => (i % 2 ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${pattern || ""}/?$`, "i");
}

// --- Resolución ------------------------------------------------------------------------------

export interface ProjectFiles {
  /** Rutas relativas a la raíz (posix) de todos los archivos. */
  files: Set<string>;
  /** Carpetas (derivadas de los archivos). */
  dirs: Set<string>;
  /** Rutas definidas por el enrutador del proyecto. */
  routes: string[];
  /** Carpetas que existen pero no se listan (vendor, node_modules): lo de dentro no se puede comprobar. */
  opaque: string[];
  /** Carpetas con un archivo de entrada de Sass (no parcial): Sass busca también desde ahí. */
  sassRoots: Set<string>;
}

export function projectFiles(paths: string[], routes: string[] = [], opaque: string[] = []): ProjectFiles {
  const files = new Set(paths);
  const dirs = new Set<string>([""]);
  const sassRoots = new Set<string>();
  for (const p of paths) {
    for (let d = posix.dirname(p); d !== "." && !dirs.has(d); d = posix.dirname(d)) dirs.add(d);
    if (/(^|\/)[^_/][^/]*\.s[ac]ss$/.test(p)) sassRoots.add(posix.dirname(p) === "." ? "" : posix.dirname(p));
  }
  return { files, dirs, routes, opaque, sassRoots };
}

/** Carpetas que sirven el sitio (donde está index.php/index.html), más la raíz. */
export function webRoots(pf: ProjectFiles): string[] {
  const roots = new Set<string>();
  for (const f of pf.files) {
    if (/(^|\/)index\.(php|html?)$/.test(f) && f.split("/").length <= 3) roots.add(posix.dirname(f) === "." ? "" : posix.dirname(f));
  }
  for (const d of ["public", "www", "htdocs", "static", "web", "dist", "public_html"]) if (pf.dirs.has(d)) roots.add(d);
  roots.add("");
  return [...roots].sort((a, b) => b.length - a.length);
}

const JS_EXTS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".json", ".vue", ".svelte"];

/** Archivos que podría designar la ruta (según el tipo: extensiones de imports, parciales de Sass…). */
function expand(base: string, kind: RefKind): string[] {
  const out = [base];
  if (kind === "import") out.push(...JS_EXTS.map((e) => base + e), ...JS_EXTS.map((e) => `${base}/index${e}`));
  if (kind === "sass") {
    const dir = posix.dirname(base);
    const name = posix.basename(base);
    for (const n of [name, `_${name}`]) for (const e of ["", ".scss", ".sass", ".css"]) out.push(posix.join(dir, n + e));
    out.push(`${base}/_index.scss`, `${base}/index.scss`);
  }
  if (kind === "ruby") out.push(`${base}.rb`);
  return out;
}

const norm = (p: string) => posix.normalize(p).replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/$/, "");

/** Dónde se busca la ruta: carpeta del archivo, raíces web o raíz del proyecto. */
function bases(ref: PathRef, fileRel: string, pf: ProjectFiles): string[] {
  const clean = ref.value.split(/[?#]/)[0];
  const dir = posix.dirname(fileRel) === "." ? "" : posix.dirname(fileRel);
  if (ref.viaDir) return [norm(posix.join(dir, clean))];
  if (clean.startsWith("/")) return webRoots(pf).map((r) => norm(posix.join(r, clean)));
  const list = [norm(posix.join(dir, clean))];
  // Sass (gulp-sass, sass-loader…) también busca desde la carpeta del archivo de entrada.
  if (ref.kind === "sass") {
    for (let a = dir; ; a = posix.dirname(a) === "." ? "" : posix.dirname(a)) {
      if (pf.sassRoots.has(a)) list.push(norm(posix.join(a, clean)));
      if (!a) break;
    }
  }
  // PHP include sin __DIR__ y CSS/HTML servidos desde la raíz web: también desde ahí.
  if (ref.kind === "include" || ref.kind === "asset" || ref.kind === "link") list.push(...webRoots(pf).map((r) => norm(posix.join(r, clean))));
  return list;
}

export type Check = { ok: true; via: "file" | "dir" | "route" } | { ok: false; suggestions: string[] };

export function checkRef(ref: PathRef, fileRel: string, pf: ProjectFiles): Check {
  const clean = ref.value.split(/[?#]/)[0];
  if (!clean) return { ok: true, via: "file" };
  for (const b of bases(ref, fileRel, pf)) {
    if (b.startsWith("..")) continue; // fuera del proyecto
    if (pf.opaque.some((o) => b === o || b.startsWith(o + "/"))) return { ok: true, via: "dir" };
    if (expand(b, ref.kind).some((c) => pf.files.has(c))) return { ok: true, via: "file" };
    if (ref.kind !== "import" && pf.dirs.has(b) && b !== "") return { ok: true, via: "dir" };
  }
  // Enlaces sin extensión: rutas del enrutador (/login, /api/x).
  const hasExt = /\.[a-z0-9]{1,5}$/i.test(clean);
  if (ref.kind === "link" && !hasExt) {
    if (!pf.routes.length || pf.routes.some((r) => routeRegex(r).test(clean.startsWith("/") ? clean : `/${clean}`))) {
      // Sin enrutador conocido no se puede saber: no se marca.
      return { ok: true, via: "route" };
    }
  }
  return { ok: false, suggestions: suggest(ref, fileRel, pf) };
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Rutas correctas propuestas, escritas en el mismo estilo que la original. */
export function suggest(ref: PathRef, fileRel: string, pf: ProjectFiles, max = 3): string[] {
  const [clean, ...rest] = ref.value.split(/(?=[?#])/);
  const suffix = rest.join("");
  const wantExt = posix.extname(clean);
  const wantName = posix.basename(clean, wantExt).replace(/^_/, "").toLowerCase();
  const dir = posix.dirname(fileRel) === "." ? "" : posix.dirname(fileRel);
  const scored: { path: string; score: number }[] = [];
  if (wantName) {
    for (const f of pf.files) {
      const ext = posix.extname(f);
      if (wantExt && ext.toLowerCase() !== wantExt.toLowerCase() && !(ref.kind === "sass" && /\.s[ac]ss$/.test(ext))) continue;
      if (!wantExt && ref.kind === "import" && !JS_EXTS.includes(ext)) continue;
      const name = posix.basename(f, ext).replace(/^_/, "").toLowerCase();
      // Nombres cortos: como mucho 1 letra de diferencia; largos: 2.
      const d = name === wantName ? 0 : levenshtein(name, wantName);
      if (d > (wantName.length >= 4 ? 2 : 1)) continue;
      // Más parecido = mismo nombre y más carpetas en común con la ruta escrita.
      const common = clean.split("/").filter((seg) => seg && f.split("/").includes(seg)).length;
      scored.push({ path: f, score: d * 10 - common });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.path.length - b.path.length);
  const out = scored.map((s) => format(s.path, ref, clean, dir, pf) + suffix);
  // Rutas del enrutador parecidas (/registr → /registro).
  if (ref.kind === "link" && !wantExt) {
    const want = clean.replace(/\/$/, "");
    const routes = pf.routes
      .filter((r) => !/[:{<[*]/.test(r))
      .map((r) => ({ r, d: levenshtein(r.toLowerCase(), want.toLowerCase()) }))
      .filter((x) => x.d <= 2)
      .sort((a, b) => a.d - b.d)
      .map((x) => x.r + suffix);
    out.unshift(...routes);
  }
  return [...new Set(out)].filter((s) => s !== ref.value).slice(0, max);
}

/** Escribe `target` (relativa a la raíz) igual que estaba escrita la ruta original. */
function format(target: string, ref: PathRef, clean: string, dir: string, pf: ProjectFiles): string {
  let out: string;
  if (ref.viaDir) out = "/" + posix.relative(dir, target);
  else if (clean.startsWith("/")) {
    const root = webRoots(pf).find((r) => r === "" || target.startsWith(r + "/")) ?? "";
    out = "/" + (root ? target.slice(root.length + 1) : target);
  } else {
    out = posix.relative(dir, target) || posix.basename(target);
    if ((clean.startsWith("./") || ref.kind === "import") && !out.startsWith(".")) out = "./" + out;
  }
  // Mantener el estilo: imports sin extensión, parciales de Sass sin "_" ni extensión.
  if (ref.kind === "import" && !posix.extname(clean)) out = out.replace(/\.(m?[jt]sx?|cjs)$/, "").replace(/\/index$/, "");
  if (ref.kind === "sass" && !posix.extname(clean)) out = posix.join(posix.dirname(out), posix.basename(out).replace(/^_/, "").replace(/\.s[ac]ss$/, ""));
  if (ref.kind === "sass" && !posix.extname(clean) && !clean.startsWith(".") && out.startsWith("./")) out = out.slice(2);
  return out;
}

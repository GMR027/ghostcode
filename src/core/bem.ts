import type { ChatRequest } from "./types";

/**
 * Metodología BEM (Block__Element--Modifier): lee la estructura del marcado (etiquetas
 * hijas y su contenido) y propone los nombres de clase. Nunca toca una clase que ya existe.
 */

export interface MarkupNode {
  tag: string;
  /** Posición de «<» y fin de la etiqueta de apertura (después de «>»). */
  start: number;
  openEnd: number;
  /** Fin de la etiqueta de cierre (o de la apertura si no tiene contenido). */
  end: number;
  parent: number;
  depth: number;
  /** Posición del valor de class="…" y su texto, si la etiqueta ya tiene el atributo. */
  cls?: { start: number; end: number; value: string };
  /** Texto propio (sin etiquetas hijas), recortado. */
  text: string;
  children: number[];
}

const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const RAW = new Set(["script", "style"]);
const TAG_RE = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>"'{])*?)(\/?)>/g;
const CLASS_RE = /\b(?:class|className)\s*=\s*(["'])([^"'<>]*?)\1/;

/** Interpreta el marcado (HTML, PHP, Vue, JSX…) como un árbol de etiquetas. */
export function parseMarkup(source: string): MarkupNode[] {
  // Los bloques <?php … ?> se tapan con espacios para que no se confundan con etiquetas.
  const text = source.replace(/<\?[\s\S]*?\?>/g, (m) => " ".repeat(m.length));
  const nodes: MarkupNode[] = [];
  const stack: number[] = [];
  let lastEnd = 0;
  const addText = (to: number) => {
    const owner = stack[stack.length - 1];
    if (owner !== undefined) {
      const t = text.slice(lastEnd, to).replace(/\{\{[\s\S]*?\}\}|\s+/g, " ").trim();
      if (t) nodes[owner].text = `${nodes[owner].text} ${t}`.trim().slice(0, 120);
    }
  };
  for (const m of text.matchAll(TAG_RE)) {
    const idx = m.index!;
    addText(idx);
    lastEnd = idx + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => nodes[n].tag).lastIndexOf(tag);
      if (at >= 0) stack.splice(at).forEach((n, k) => (nodes[n].end = k === 0 ? lastEnd : idx));
      continue;
    }
    const parent = stack.length ? stack[stack.length - 1] : -1;
    const node: MarkupNode = { tag, start: idx, openEnd: lastEnd, end: lastEnd, parent, depth: stack.length, text: "", children: [] };
    const attrs = m[3];
    const c = CLASS_RE.exec(attrs);
    if (c) {
      const valueStart = idx + 1 + m[2].length + c.index + c[0].indexOf(c[1]) + 1;
      node.cls = { start: valueStart, end: valueStart + c[2].length, value: c[2] };
    }
    nodes.push(node);
    if (parent >= 0) nodes[parent].children.push(nodes.length - 1);
    if (m[4] || VOID.has(tag)) continue;
    if (RAW.has(tag)) {
      const close = text.toLowerCase().indexOf(`</${tag}`, lastEnd);
      lastEnd = close < 0 ? text.length : close;
      continue;
    }
    stack.push(nodes.length - 1);
  }
  for (const n of stack) nodes[n].end = text.length;
  return nodes;
}

/** Etiquetas abiertas (de fuera hacia dentro) al final del texto: los ancestros de lo que se escribe ahí. */
export function openAncestors(source: string): MarkupNode[] {
  const nodes = parseMarkup(source);
  const byStart = new Map(nodes.map((n) => [n.start, n]));
  const text = source.replace(/<\?[\s\S]*?\?>/g, (m) => " ".repeat(m.length));
  const stack: MarkupNode[] = [];
  for (const m of text.matchAll(TAG_RE)) {
    if (m[0].startsWith("<!--")) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
    } else if (!m[4] && !VOID.has(tag) && !RAW.has(tag)) {
      const node = byStart.get(m.index!);
      if (node) stack.push(node);
    }
  }
  return stack;
}

// --- Nombres -------------------------------------------------------------------------

/** Qué «papel» suele tener cada etiqueta dentro de un bloque. */
const ROLE: Record<string, string> = {
  h1: "title", h2: "title", h3: "subtitle", h4: "subtitle", h5: "subtitle", h6: "subtitle",
  p: "text", a: "link", img: "image", picture: "image", figure: "figure", figcaption: "caption",
  ul: "list", ol: "list", li: "item", button: "button", input: "input", textarea: "input", select: "select",
  label: "label", form: "form", nav: "nav", span: "label", small: "note", strong: "highlight", em: "highlight",
  header: "header", footer: "footer", table: "table", tr: "row", td: "cell", th: "cell", video: "video",
  blockquote: "quote", time: "date", address: "address", svg: "icon", i: "icon",
};
const GENERIC = new Set(["div", "section", "article", "aside", "main", "span"]);
/** Etiquetas a las que no se les pone clase. */
const SKIP = new Set("html head body script style meta link title br hr tbody thead tfoot colgroup col path g use defs".split(" "));
const BLOCK_ROLE: Record<string, string> = {
  header: "header", footer: "footer", nav: "nav", form: "form", ul: "list", ol: "list", table: "table", main: "main", aside: "sidebar",
};

const STOP = new Set("de del la el los las un una y en con para por the of and for with to".split(" "));

export const slug = (s: string, words = 2): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w))
    .slice(0, words)
    .join("-");

/** La parte «bloque» de una clase BEM: `card__title--big` → `card`. */
export const blockOf = (cls: string): string => cls.split(/__|--/)[0];

const hasClass = (n: MarkupNode) => !!n.cls && n.cls.value.trim().length > 0;
const firstToken = (n: MarkupNode) => n.cls!.value.trim().split(/\s+/)[0];

/** El bloque al que pertenece un elemento: el de su ancestro con clase más cercano. */
export function blockFor(ancestors: MarkupNode[]): string | undefined {
  for (let i = ancestors.length - 1; i >= 0; i--) if (hasClass(ancestors[i])) return blockOf(firstToken(ancestors[i]));
  return undefined;
}

/** Descendientes de un nodo, en orden de aparición. */
const descendants = (nodes: MarkupNode[], i: number): MarkupNode[] =>
  nodes[i].children.flatMap((c) => [nodes[c], ...descendants(nodes, c)]);

/** Papel de una etiqueta genérica según lo que contiene. */
function roleFromContent(nodes: MarkupNode[], i: number): string | undefined {
  const kids = descendants(nodes, i);
  const tags = kids.map((k) => k.tag);
  if (!kids.length) return slug(nodes[i].text, 2) || undefined;
  if (tags.includes("li")) return "list";
  if (tags.includes("form") || tags.includes("input")) return "form";
  if (tags.every((t) => t === "a" || t === "span")) return "links";
  if (tags.includes("button") && tags.length <= 3) return "actions";
  if (tags.includes("img") && tags.length <= 2) return "media";
  if (tags.some((t) => /^h[1-6]$/.test(t))) return "content";
  return undefined;
}

/** Nombre sugerido para el bloque de un elemento raíz (sin ancestros con clase). */
export function suggestBlockName(nodes: MarkupNode[], i: number, fallback = "block"): string {
  const n = nodes[i];
  if (BLOCK_ROLE[n.tag]) return BLOCK_ROLE[n.tag];
  const heading = descendants(nodes, i).find((k) => /^h[1-6]$/.test(k.tag) && k.text);
  return slug(heading?.text ?? "", 2) || (GENERIC.has(n.tag) && n.tag !== "div" && n.tag !== "span" ? n.tag : slug(fallback, 2) || "block");
}

/** Nombre sugerido para el elemento `i` dentro de `block`: `block__role`. */
export function suggestElementName(nodes: MarkupNode[], i: number, block: string): string {
  const n = nodes[i];
  const role = GENERIC.has(n.tag) && (n.tag !== "span" || n.children.length) ? roleFromContent(nodes, i) ?? ROLE[n.tag] ?? "wrapper" : ROLE[n.tag] ?? roleFromContent(nodes, i) ?? "item";
  return `${block}__${role}`;
}

/** Modificadores ya usados en el archivo para ese nombre (`card__title--big` → `big`). */
export function knownModifiers(source: string, base: string): string[] {
  const out = new Set<string>();
  const re = new RegExp(`(?<![\\w-])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}--([a-z0-9][a-z0-9-]*)`, "g");
  for (const m of source.matchAll(re)) out.add(m[1]);
  return [...out];
}

// --- Aplicar BEM a un bloque de marcado -------------------------------------------------

export interface BemEdit {
  /** Posición donde insertar (o reemplazar el valor vacío) y el texto de la clase. */
  at: number;
  end: number;
  /** Inserción completa: `class="x"` si no había atributo, o solo `x` si el atributo estaba vacío. */
  text: string;
}

/**
 * Plan para dar clases BEM a `root` y a todo lo que contiene. Solo se llenan las etiquetas SIN
 * clase: lo que el usuario ya escribió (o cambió) no se toca.
 * `names` permite que la IA aporte el papel de las etiquetas genéricas (índice del nodo → papel).
 */
export function planBem(
  nodes: MarkupNode[],
  root: number,
  attr: "class" | "className",
  opts: { block?: string; names?: Map<number, string>; fallbackBlock?: string } = {},
): { edits: BemEdit[]; block: string } {
  const edits: BemEdit[] = [];
  const ancestors: MarkupNode[] = [];
  for (let p = nodes[root].parent; p >= 0; p = nodes[p].parent) ancestors.unshift(nodes[p]);
  const inherited = blockFor(ancestors);
  let block = inherited ?? (hasClass(nodes[root]) ? blockOf(firstToken(nodes[root])) : opts.block);
  block ??= suggestBlockName(nodes, root, opts.fallbackBlock);

  const put = (i: number, name: string) => {
    const n = nodes[i];
    if (n.cls) edits.push({ at: n.cls.start, end: n.cls.end, text: name });
    else edits.push({ at: -n.openEnd, end: -n.openEnd, text: `${attr}="${name}"` });
  };

  // `scope` es el bloque al que pertenece el subárbol del nodo. Un hijo que ya tiene clase
  // se respeta; si es otro bloque (sin «__»), sus hijos pasan a ser elementos de ese bloque.
  const visit = (i: number, scope: string) => {
    const n = nodes[i];
    let next = scope;
    if (!SKIP.has(n.tag)) {
      if (hasClass(n)) next = blockOf(firstToken(n));
      else if (i === root && !inherited) put(i, scope);
      else {
        const role = opts.names?.get(i);
        put(i, role ? `${scope}__${role}` : suggestElementName(nodes, i, scope));
      }
    }
    for (const c of n.children) visit(c, next);
  };
  visit(root, block);
  return { edits, block };
}

/** Convierte el plan en reemplazos sobre el texto real (inserta antes del «>» o «/>»). */
export function resolveBemEdits(text: string, edits: BemEdit[]): BemEdit[] {
  return edits.map((e) => {
    if (e.at >= 0) return e;
    const openEnd = -e.at;
    const selfClose = text[openEnd - 2] === "/";
    const pos = openEnd - (selfClose ? 2 : 1);
    const gap = /\s$/.test(text.slice(0, pos)) ? "" : " ";
    return { at: pos, end: pos, text: `${gap}${e.text}${selfClose ? " " : ""}` };
  });
}

export function applyBemEdits(text: string, edits: BemEdit[]): string {
  let out = text;
  for (const e of resolveBemEdits(text, edits).sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return out;
}

// --- Ayuda de la IA ---------------------------------------------------------------------

/** Pide al modelo el papel (el «elemento» BEM) de las etiquetas genéricas, según su contenido. */
export function bemRequest(outline: { i: number; tag: string; text: string; parent: number }[], block: string, lang: string): ChatRequest {
  return {
    system: [
      "You name HTML elements following the BEM methodology (Block__Element--Modifier).",
      `The block is "${block}". For each listed element choose a short, lowercase, hyphenated ROLE (1-2 words, e.g. title, price, thumbnail, actions) that describes its purpose from its content.`,
      "Do not repeat the block name and do not include the prefix: only the role. Reuse the same role for repeated, equivalent elements.",
      'Answer ONLY with JSON: {"<index>":"<role>", …}.',
      `Content is in ${lang}; roles should be in English.`,
    ].join("\n"),
    user: outline.map((o) => `${o.i}. <${o.tag}> (child of ${o.parent}) ${o.text ? `"${o.text.slice(0, 80)}"` : ""}`).join("\n"),
    maxTokens: 300,
    temperature: 0.1,
  };
}

export function parseBemNames(raw: string, allowed: number[]): Map<number, string> {
  const out = new Map<number, string>();
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return out;
  try {
    for (const [k, v] of Object.entries(JSON.parse(json) as Record<string, unknown>)) {
      const i = Number(k);
      const role = typeof v === "string" ? slug(v, 2) : "";
      if (allowed.includes(i) && role) out.set(i, role);
    }
  } catch {
    // respuesta que no es JSON: se usan los nombres por defecto
  }
  return out;
}

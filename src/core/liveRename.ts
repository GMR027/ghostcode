import type { ChatRequest } from "./types";

/**
 * Lógica pura del «renombrado en vivo»: detecta que el usuario cambió el nombre de una
 * variable/función/clase o de una clase CSS, y calcula qué otros sitios hay que cambiar.
 */

export interface Renamed {
  old: string;
  new: string;
  /** Posición (en la línea nueva) donde quedó el nombre editado. */
  col: number;
}
export interface Span {
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_$]/u;
const isWord = (c: string | undefined) => !!c && WORD.test(c);
const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
const CLASS_CHAR = /[\w-]/;
const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/;

// Palabras reservadas habituales: al teclear «i» → «if» no es un renombrado.
const RESERVED = new Set(
  ("if else for while do switch case break continue return function class new this self var let const def fn func " +
    "public private protected static final void int string bool true false null none try catch finally throw import " +
    "export from as in is not and or use namespace echo print foreach elseif extends implements interface enum").split(" "),
);

/** Un identificador válido y completo (no a medio escribir). */
export function isRenameable(name: string): boolean {
  return IDENT.test(name) && /[\p{L}\p{N}_]/u.test(name) && !RESERVED.has(name.toLowerCase());
}

/** Prefijo y sufijo comunes entre dos líneas: lo que queda en medio es lo que cambió. */
function changedMiddle(before: string, after: string): { p: number; bEnd: number; aEnd: number } {
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < max - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { p, bEnd: before.length - s, aEnd: after.length - s };
}

function widen(t: string, from: number, to: number, isChar: (c: string | undefined) => boolean): [number, number] {
  let a = from;
  let b = to;
  while (a > 0 && isChar(t[a - 1])) a--;
  while (b < t.length && isChar(t[b])) b++;
  return [a, b];
}

/**
 * Si entre `before` y `after` (la misma línea) solo cambió un identificador, devuelve el
 * nombre viejo y el nuevo. `null` si el cambio es otra cosa (varias palabras, símbolos…).
 */
export function diffIdentifier(before: string, after: string): Renamed | null {
  if (before === after) return null;
  const { p, bEnd, aEnd } = changedMiddle(before, after);
  const [a1, b1] = widen(before, p, bEnd, isWord);
  const [a2, b2] = widen(after, p, aEnd, isWord);
  if (before.slice(0, a1) !== after.slice(0, a2) || before.slice(b1) !== after.slice(b2)) return null;
  const old = before.slice(a1, b1);
  const nu = after.slice(a2, b2);
  if (old === nu || !isRenameable(old) || !isRenameable(nu)) return null;
  return { old, new: nu, col: a2 };
}

/** Cambio de un nombre de clase en un selector CSS (`.hola` → `.hi`) en la misma línea. */
export function diffSelectorClass(before: string, after: string): Renamed | null {
  if (before === after) return null;
  const { p, bEnd, aEnd } = changedMiddle(before, after);
  const isCls = (c: string | undefined) => !!c && CLASS_CHAR.test(c);
  const [a1, b1] = widen(before, p, bEnd, isCls);
  const [a2, b2] = widen(after, p, aEnd, isCls);
  if (before.slice(0, a1) !== after.slice(0, a2) || before.slice(b1) !== after.slice(b2)) return null;
  if (before[a1 - 1] !== ".") return null;
  const old = before.slice(a1, b1);
  const nu = after.slice(a2, b2);
  if (old === nu || !CLASS_NAME.test(old) || !isClassComplete(nu)) return null;
  return { old, new: nu, col: a2 };
}

const isClassComplete = (name: string) => CLASS_NAME.test(name) && !/[-_]$/.test(name);

const CLASS_ATTR = /\b(class|className)(\s*=\s*)(["'])([^"'<>]*?)\3/g;

/** Cambio de un token dentro de `class="…"` en la misma línea. */
export function diffClassAttr(before: string, after: string): Renamed | null {
  const a = [...before.matchAll(CLASS_ATTR)];
  const b = [...after.matchAll(CLASS_ATTR)];
  if (!a.length || a.length !== b.length) return null;
  const changed = a.map((m, i) => i).filter((i) => a[i][4] !== b[i][4]);
  if (changed.length !== 1) return null;
  const i = changed[0];
  const ta = a[i][4].split(/\s+/).filter(Boolean);
  const tb = b[i][4].split(/\s+/).filter(Boolean);
  if (ta.length !== tb.length) return null;
  const diff = ta.map((t, k) => k).filter((k) => ta[k] !== tb[k]);
  if (diff.length !== 1) return null;
  const old = ta[diff[0]];
  const nu = tb[diff[0]];
  if (!CLASS_NAME.test(old) || !isClassComplete(nu)) return null;
  return { old, new: nu, col: b[i].index! };
}

/** Rangos del nombre `word` como palabra completa (`$a` no coincide con `$ab`, `a` no con `$a`). */
export function wordSpans(text: string, word: string, within?: Span): Span[] {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRe(word)}(?![\\p{L}\\p{N}_$])`, "gu");
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    if (within && (start < within.start || start + word.length > within.end)) continue;
    out.push({ start, end: start + word.length });
  }
  return out;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Context = "code" | "member" | "string" | "comment";

/** Dónde está una coincidencia: código, propiedad (`x.nombre`), cadena o comentario. */
export function contextAt(text: string, index: number): Context {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const before = text.slice(lineStart, index);
  if (/(\.|->|::)\s*$/.test(before)) return "member";
  let quote: string | undefined;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ((c === "/" && before[i + 1] === "/") || c === "#" || (c === "-" && before[i + 1] === "-")) return "comment";
  }
  if (quote) return "string";
  if (/\/\*(?![\s\S]*\*\/)/.test(text.slice(Math.max(0, index - 2000), index))) return "comment";
  return "code";
}

// --- Clases CSS ----------------------------------------------------------------------

/**
 * Rangos de `old` dentro de los atributos `class`/`className` de un texto. Con `bem`, también
 * los derivados `old__elemento` y `old--modificador` (solo se cambia la parte del bloque).
 */
export function classTokenSpans(text: string, old: string, bem = false): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(CLASS_ATTR)) {
    const valueStart = m.index! + m[1].length + m[2].length + 1;
    for (const t of m[4].matchAll(/\S+/g)) {
      const hit = t[0] === old || (bem && isBemOf(t[0], old));
      if (hit) out.push({ start: valueStart + t.index!, end: valueStart + t.index! + old.length });
    }
  }
  return out;
}

const isBemOf = (token: string, block: string) => token.startsWith(`${block}__`) || token.startsWith(`${block}--`);

/** Rangos de `.old` (solo el nombre) en selectores CSS/SCSS/Sass/Less. */
export function selectorSpans(text: string, old: string, bem = false): Span[] {
  const re = new RegExp(`(?<!\\d)\\.(${escapeRe(old)})(?=([\\w-]?))`, "g");
  const out: Span[] = [];
  for (const m of text.matchAll(re)) {
    const rest = text.slice(m.index! + 1 + old.length, m.index! + 3 + old.length);
    const ends = !CLASS_CHAR.test(m[2]);
    if (ends || (bem && (rest.startsWith("__") || rest.startsWith("--")))) {
      out.push({ start: m.index! + 1, end: m.index! + 1 + old.length });
    }
  }
  return out;
}

/**
 * Clases que el JavaScript escribe como texto: `querySelector('.old')`, `closest`, `matches`,
 * `classList.add/remove/toggle/contains/replace('old')` y `getElementsByClassName('old')`.
 */
export function jsClassSpans(text: string, old: string, bem = false): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(/\b(?:querySelector(?:All)?|closest|matches)\(\s*(["'`])((?:\\.|(?!\1)[^\n])*)\1/g)) {
    const base = m.index! + m[0].indexOf(m[1]) + 1;
    for (const s of selectorSpans(m[2], old, bem)) out.push({ start: s.start + base, end: s.end + base });
  }
  for (const m of text.matchAll(/\b(?:classList\.(?:add|remove|toggle|contains|replace)|getElementsByClassName)\(([^)]*)\)/g)) {
    const base = m.index! + m[0].indexOf("(") + 1;
    for (const a of m[1].matchAll(/(["'`])([\w-]+)\1/g)) {
      if (a[2] === old || (bem && isBemOf(a[2], old))) out.push({ start: base + a.index! + 1, end: base + a.index! + 1 + old.length });
    }
  }
  return out;
}

/** Rangos de los bloques `<style>…</style>` de un archivo de marcado. */
export function styleBlocks(text: string): Span[] {
  return [...text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => ({
    start: m.index! + m[0].indexOf(m[1]),
    end: m.index! + m[0].indexOf(m[1]) + m[1].length,
  }));
}

/** ¿Aparece `cls` como clase en este texto (atributo class)? */
export const usesClass = (text: string, cls: string) => classTokenSpans(text, cls).length > 0;

/** Aplica reemplazos por rango (de atrás hacia delante, para no desplazar los demás). */
export function applySpans(text: string, spans: Span[], replacement: string): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + replacement + out.slice(s.end);
  return out;
}

// --- Ayuda de la IA ---------------------------------------------------------------------

export interface Candidate {
  i: number;
  line: string;
  context: Context;
}

/** Pide al modelo que decida cuáles coincidencias dudosas (cadenas, propiedades) son la misma cosa. */
export function renameJudgeRequest(old: string, nu: string, edited: string, cands: Candidate[], languageId: string): ChatRequest {
  return {
    system: [
      "You help a code editor propagate a rename. The user renamed an identifier; some other occurrences of the old name are ambiguous.",
      "For each candidate decide whether it refers to the SAME thing (a reference to the renamed variable/function/class) and must be renamed,",
      "or to something unrelated (a string literal, an array key, a property of another object, plain prose) and must be left alone.",
      'Answer ONLY with JSON: {"rename":[<indexes to rename>]}. When in doubt, do not rename.',
    ].join("\n"),
    user: `Language: ${languageId}\nRenamed: ${old} -> ${nu}\nEdited line: ${edited.trim()}\nCandidates:\n${cands
      .map((c) => `${c.i}. [${c.context}] ${c.line.trim().slice(0, 200)}`)
      .join("\n")}`,
    maxTokens: 120,
    temperature: 0,
  };
}

/** Índices que el modelo aprobó (solo los que estaban entre los candidatos). */
export function parseJudge(raw: string, allowed: number[]): number[] {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0];
  if (!json) return [];
  try {
    const list = (JSON.parse(json) as { rename?: unknown }).rename;
    if (!Array.isArray(list)) return [];
    return list.filter((n): n is number => typeof n === "number" && allowed.includes(n));
  } catch {
    return [];
  }
}

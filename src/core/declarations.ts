/**
 * Detección de declaraciones (clases, funciones, miembros) con reglas de texto que
 * funcionan en casi cualquier lenguaje, sin depender de extensiones instaladas.
 * Se usa para el contexto del proyecto y como respaldo cuando un lenguaje no
 * tiene proveedor de símbolos.
 */

export type DeclKind = "class" | "function" | "field";

export interface Declaration {
  name: string;
  kind: DeclKind;
  /** Línea (0-based) donde empieza. */
  line: number;
  indent: number;
  /** Firma en una línea, sin cuerpo. */
  signature: string;
  /** Clase de la que hereda (solo clases). */
  parent?: string;
  /** Clase que la contiene (miembros). */
  container?: string;
  /** Última línea del bloque (solo clases y funciones). */
  end?: number;
}

const NOT_NAMES = new Set([
  "if", "for", "while", "switch", "catch", "return", "new", "else", "elseif", "elif", "foreach", "do", "try",
  "with", "when", "match", "case", "sizeof", "typeof", "await", "yield", "throw", "delete", "in", "of", "and",
  "or", "not", "is", "echo", "print", "require", "include", "import", "from", "using", "namespace", "package",
  "function", "func", "fn", "def", "class", "struct", "lambda", "unless", "until", "loop", "select", "defer", "go",
]);

const MODS =
  "(?:(?:export|default|public|private|protected|internal|abstract|final|sealed|static|data|open|partial|declare|readonly|async|override|inline|suspend|unsafe|virtual|local|extern(?:\\s+\"[^\"]*\")?|pub(?:\\([^)]*\\))?|const)\\s+)*";
const ID = "[A-Za-z_$][\\w$]*";

const CLASS_RE = new RegExp(`^\\s*${MODS}(class|interface|trait|struct|enum|record|object|protocol|module|defmodule|union|impl)\\s+(${ID}(?:[.:]+${ID})*)`);
const GO_TYPE_RE = new RegExp(`^\\s*type\\s+(${ID})\\s+(?:struct|interface)\\b`);
const SQL_RE = /^\s*create\s+(?:or\s+replace\s+)?(table|view|function|procedure)\s+(?:if\s+not\s+exists\s+)?[`"[]?([\w.]+)/i;
const FN_RE = new RegExp(
  `^\\s*${MODS}(?:function\\*?|func|fn|def|defp|fun|sub|proc|procedure)\\s+(?:\\([^)]*\\)\\s*)?(?:self\\.)?(${ID}(?:[.:]${ID})*[?!]?)`,
);
const ARROW_RE = new RegExp(
  `^\\s*(?:export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>|${ID}\\s*=>)`,
);
// Java, C#, C, C++, Dart…: tipo nombre(args)  — exige tipo o modificador para no confundir llamadas.
const CLIKE_RE = new RegExp(
  `^\\s*((?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|synchronized|native|inline|extern|unsafe|export)\\s+)*)` +
    `([\\w$][\\w$<>\\[\\],.*&?:]*(?:<[^>()]*>)?)\\s+[*&]*(${ID})\\s*\\(([^;]*)$`,
);
// Métodos JS/TS sin palabra clave: "  nombre(args) {" / "async nombre(args): T {"
const METHOD_RE = new RegExp(`^\\s*(?:(?:async|static|get|set|public|private|protected|override|readonly)\\s+)*\\*?(${ID})\\s*\\([^)]*\\)\\s*(?::\\s*[^={]+)?\\{\\s*$`);
const FIELD_RE = new RegExp(
  `^\\s*(?:(?:public|private|protected|internal|readonly|static|var|val|final|const|let)\\s+)+[^(=;{]*?[$]?(${ID})\\s*(?:[:=;?]|$)`,
);

export function indentOf(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

const lastSegment = (name: string) => name.split(/[.:]+/).filter(Boolean).pop() ?? name;

/** Firma legible: la línea de declaración (y las siguientes si los paréntesis siguen abiertos), sin cuerpo. */
function signatureAt(lines: string[], i: number): string {
  let sig = lines[i].trim();
  for (let k = 1; k <= 4 && count(sig, "(") > count(sig, ")") && i + k < lines.length; k++) sig += " " + lines[i + k].trim();
  sig = sig.replace(/\s*\{.*$/, "").replace(/\s*(=>|->)?\s*$/, "").replace(/:\s*$/, "");
  return sig.length > 160 ? sig.slice(0, 157) + "…" : sig;
}

const count = (s: string, ch: string) => s.split(ch).length - 1;

function parentOf(line: string): string | undefined {
  const m =
    /\bextends\s+([\w.\\]+)/.exec(line) ??
    /^\s*class\s+\w+\s*\(\s*([\w.]+)/.exec(line) ?? // Python
    /^\s*class\s+\w+\s*<\s*([\w:]+)/.exec(line) ?? // Ruby
    /^\s*(?:\w+\s+)*class\s+\w+(?:<[^>]*>)?\s*:\s*([\w.]+)/.exec(line); // C#, Kotlin, Swift
  return m ? m[1].split(/[.\\:]+/).pop() : undefined;
}

/** Clasifica una línea. */
function matchLine(line: string): { kind: DeclKind; name: string } | undefined {
  let m = CLASS_RE.exec(line) ?? GO_TYPE_RE.exec(line);
  if (m) return { kind: "class", name: lastSegment(m[2] ?? m[1]) };
  if ((m = SQL_RE.exec(line))) return { kind: /table|view/i.test(m[1]) ? "class" : "function", name: lastSegment(m[2]) };
  if ((m = FN_RE.exec(line))) return { kind: "function", name: lastSegment(m[1]) };
  if ((m = ARROW_RE.exec(line))) return { kind: "function", name: m[1] };
  if ((m = CLIKE_RE.exec(line))) {
    const [, , type, name, rest] = m;
    const looksLikeDef = /\)\s*(?:const\s*)?(?:throws\s+[\w.,\s]+)?(?:\{|=>|:.*)?\s*$/.test(rest) || !rest.includes(")");
    // Nombres en mayúsculas: tipos SQL (VARCHAR(100)) o macros de C, no funciones.
    const allCaps = /^[A-Z0-9_]+$/.test(name);
    if (!NOT_NAMES.has(type) && !NOT_NAMES.has(name) && !/^(return|new|await|throw|else|echo)$/.test(type) && looksLikeDef && !allCaps) {
      return { kind: "function", name };
    }
  }
  if ((m = METHOD_RE.exec(line)) && !NOT_NAMES.has(m[1])) return { kind: "function", name: m[1] };
  return undefined;
}

/** Quita cadenas y comentarios de línea para contar llaves sin confundirse. */
function codeOnly(line: string): string {
  return line
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""')
    .replace(/\/\/.*$|#(?![[{]).*$|--.*$/, "");
}

/**
 * Última línea del bloque que empieza en `start`: por llaves (o paréntesis, p. ej. SQL)
 * si la declaración abre una, si no por indentación (Python, Ruby, Lua…).
 */
export function blockEnd(lines: string[], start: number): number {
  let depth = 0;
  let opened = false;
  let opener = "{";
  let closer = "}";
  for (let i = start; i < Math.min(lines.length, start + 6) && !opened; i++) {
    const code = codeOnly(lines[i]);
    if (code.includes("{")) opened = true;
    else if (/\(\s*$/.test(code) && /^\s*create\b/i.test(lines[start])) {
      opened = true;
      opener = "(";
      closer = ")";
    }
    if (code.trim().endsWith(";") && !opened) break;
  }
  if (opened) {
    for (let i = start; i < lines.length; i++) {
      for (const ch of codeOnly(lines[i])) {
        if (ch === opener) depth++;
        else if (ch === closer && --depth === 0) return i;
      }
    }
    return lines.length - 1;
  }
  const base = indentOf(lines[start]);
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) <= base) {
      // `end`, `}` o similar al nivel de la declaración cierra el bloque.
      if (/^\s*(end\b|\}|\)|fi\b|done\b|esac\b)/.test(lines[i])) end = i;
      break;
    }
    end = i;
  }
  return end;
}

/** Todas las declaraciones del texto, con su clase contenedora y fin de bloque. */
export function extractDeclarations(text: string): Declaration[] {
  const lines = text.split(/\r?\n/);
  const out: Declaration[] = [];
  const classes: Declaration[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Saltar comentarios de bloque /* … */ y líneas comentadas.
    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (/^\s*\/\*/.test(line) && !line.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (/^\s*(\/\/|#(?!\[)|--|\*|;|%|')/.test(line) || line.length > 400) continue;

    const container = classes.find((c) => c.line < i && (c.end ?? -1) >= i && indentOf(line) > c.indent);
    const hit = matchLine(line);
    if (hit) {
      const d: Declaration = { name: hit.name, kind: hit.kind, line: i, indent: indentOf(line), signature: signatureAt(lines, i) };
      if (container) d.container = container.name;
      d.end = blockEnd(lines, i);
      if (hit.kind === "class") {
        d.parent = parentOf(line);
        classes.unshift(d); // las más internas primero
      }
      out.push(d);
      continue;
    }
    // Propiedades: solo dentro de una clase y a nivel de miembro.
    if (container) {
      const f = FIELD_RE.exec(line);
      if (f && !NOT_NAMES.has(f[1])) {
        out.push({ name: f[1], kind: "field", line: i, indent: indentOf(line), signature: line.trim().replace(/;\s*$/, ""), container: container.name });
      }
    }
  }
  return out;
}

/** Miembros directos de una clase (sin los de clases anidadas). */
export function membersOf(decls: Declaration[], cls: Declaration): Declaration[] {
  const members = decls.filter((d) => d.container === cls.name && d.line > cls.line && d.line <= (cls.end ?? Infinity));
  const level = Math.min(...members.map((m) => m.indent));
  return members.filter((m) => m.indent === level);
}

/**
 * Resumen de una clase: su firma y la de sus miembros directos. Con `inherited`, añade
 * los miembros heredados que no redefine (p. ej. `ActiveRecord::all()` en un modelo).
 */
export function outlineOf(
  decls: Declaration[],
  cls: Declaration,
  maxMembers = 25,
  inherited?: { from: string; members: Declaration[] },
): string {
  const direct = membersOf(decls, cls);
  const braces = !/:\s*$/.test(cls.signature) && !/^\s*(class|module)\s+\w+.*(<|\()/.test(cls.signature);
  const lines = [cls.signature + (braces ? " {" : "")];
  for (const m of direct.slice(0, maxMembers)) lines.push("  " + m.signature);
  if (direct.length > maxMembers) lines.push("  …");
  if (inherited) {
    const own = new Set(direct.map((m) => m.name));
    const extra = inherited.members.filter((m) => !own.has(m.name) && m.kind === "function").slice(0, maxMembers);
    if (extra.length) {
      lines.push(`  // heredado de ${inherited.from}:`);
      for (const m of extra) lines.push("  " + m.signature);
    }
  }
  if (braces) lines.push("}");
  return lines.join("\n");
}

const COMMON = new Set([
  "this", "self", "super", "true", "false", "null", "None", "nil", "undefined", "console", "document", "window",
  "string", "int", "float", "bool", "boolean", "void", "var", "let", "const", "return", "function", "public",
  "private", "protected", "static", "class", "new", "import", "export", "from", "async", "await", "echo",
  "array", "list", "dict", "len", "print", "printf", "length", "push", "map", "get", "set", "value", "data",
]);

/**
 * Identificadores usados cerca del cursor, del más cercano al más lejano.
 * `text` es el código justo antes del cursor (y la línea actual).
 */
export function referencedNames(text: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const ids = text.match(/[A-Za-z_][\w]*/g) ?? [];
  for (let i = ids.length - 1; i >= 0 && out.length < max; i--) {
    const id = ids[i];
    if (id.length < 3 || seen.has(id) || COMMON.has(id) || NOT_NAMES.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Si el cursor está justo tras `variable->`, `variable.` o `variable::`, la clase con la
 * que se creó esa variable (`$x = new Usuario(…)`, `x = Usuario(…)`, `x := &Usuario{…}`).
 */
export function receiverClass(textBeforeCursor: string): string | undefined {
  const m = /(\$?[A-Za-z_][\w]*)\s*(?:->|\?->|\.|::)\s*\w*$/.exec(textBeforeCursor);
  if (!m) return undefined;
  const v = m[1].replace(/[$]/g, "\\$");
  const assign = new RegExp(
    `${v}\\s*(?::\\s*[\\w<>?]+\\s*)?(?::=|=)\\s*(?:new\\s+|&)?([A-Z][\\w]*)(?:\\.\\w+)?\\s*[({]`,
    "g",
  );
  let found: string | undefined;
  for (let a = assign.exec(textBeforeCursor); a; a = assign.exec(textBeforeCursor)) found = a[1];
  // Tipo declarado: "Usuario $x", "x: Usuario", "Usuario x =".
  if (!found) {
    const typed = new RegExp(`([A-Z][\\w]*)\\s+${v}\\b|${v}\\s*:\\s*([A-Z][\\w]*)`).exec(textBeforeCursor);
    found = typed?.[1] ?? typed?.[2];
  }
  return found;
}

import type { ChatRequest } from "./types";

/**
 * Detección de consultas SQL y expresiones regulares bajo el puntero, para explicarlas.
 * Funciona por texto, así que vale para cualquier lenguaje.
 */

export interface Literal {
  /** Contenido sin comillas ni barras. */
  text: string;
  /** Texto completo tal como aparece (con comillas, barras y flags). */
  raw: string;
  start: number;
  end: number;
  regexLiteral: boolean;
}

/** ¿Puede empezar aquí una expresión regular literal /…/ (JS, Ruby, Perl…)? */
function regexAllowedAfter(before: string): boolean {
  const t = before.trimEnd();
  return !t || /[(,=:[!&|?{};+\-*%<>~^]$/.test(t) || /\b(return|typeof|case|in|of|split|match|when)$/.test(t);
}

/** Cadenas y regex literales de una línea, ignorando comentarios. */
export function literalsIn(line: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "/" && line[i + 1] === "/") break;
    if (c === "#" && !/[\w$]/.test(line[i - 1] ?? "") && line[i + 1] !== "{" && line[i + 1] !== "[") break;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < line.length && line[j] !== c) j += line[j] === "\\" ? 2 : 1;
      const prefix = /[rRbBuUfF@]$/.test(line.slice(0, i)) ? 1 : 0; // r'…' (Python), @"…" (C#)
      out.push({ text: line.slice(i + 1, j), raw: line.slice(i - prefix, j + 1), start: i - prefix, end: Math.min(j + 1, line.length), regexLiteral: false });
      i = j + 1;
      continue;
    }
    if (c === "/" && line[i + 1] !== "*" && regexAllowedAfter(line.slice(0, i))) {
      let j = i + 1;
      let inClass = false;
      while (j < line.length && (line[j] !== "/" || inClass)) {
        if (line[j] === "\\") j++;
        else if (line[j] === "[") inClass = true;
        else if (line[j] === "]") inClass = false;
        j++;
      }
      if (j < line.length && j > i + 1) {
        let k = j + 1;
        while (k < line.length && /[a-z]/i.test(line[k])) k++;
        out.push({ text: line.slice(i + 1, j), raw: line.slice(i, k), start: i, end: k, regexLiteral: true });
        i = k;
        continue;
      }
    }
    i++;
  }
  return out;
}

const SQL_KEYWORDS = /\b(select|insert\s+into|update|delete\s+from|create\s+(?:table|view|index)|alter\s+table|drop\s+table|from|where|join|values|set|group\s+by|order\s+by|limit|having|union)\b/gi;
const REGEX_TOKENS = /\\[dwsbDWSB.]|\[[^\]]+\]|\(\?[:=!<]|[^\\][+*?]\)?|\{\d+(,\d*)?\}|^\^|\$$|\|/g;
const REGEX_CONTEXT = /\b(preg_\w+|RegExp|Regex|regexp|re\.(?:compile|match|search|sub|findall|fullmatch|split)|Pattern\.compile|matches|gsub|sub|scan|test|match|matchAll|replace|replaceAll|split|search|grep|sed)\b|=~|!~/;
// PHP: '/patrón/i', '#…#', '~…~'
const DELIMITED = /^([/#~!@%|])(.+)\1[imsxuADSUXJn]*$/s;

export function sqlScore(text: string): number {
  return new Set((text.match(SQL_KEYWORDS) ?? []).map((k) => k.toLowerCase().split(/\s+/)[0])).size;
}

export function looksLikeRegex(text: string): boolean {
  return (text.match(REGEX_TOKENS) ?? []).length >= 2 && !/\s{2,}/.test(text) && !/^\w+$/.test(text);
}

export type LiteralKind = "sql" | "regex";

const SQL_SHAPE = /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\b[\s\S]*\bset\b|\bdelete\s+from\b|\bcreate\s+(?:or\s+replace\s+)?(?:table|view|index|function|procedure)\b|\balter\s+table\b|\bdrop\s+table\b/i;

export function looksLikeSql(text: string): boolean {
  return sqlScore(text) >= 2 && SQL_SHAPE.test(text);
}

/**
 * ¿Qué hay bajo el puntero? `lines` es el documento y (line, ch) la posición.
 * Para SQL devuelve la sentencia completa (puede estar repartida en varias líneas
 * y concatenaciones); para una regex, el literal.
 */
export function literalAt(lines: string[], line: number, ch: number, languageId: string): { kind: LiteralKind; text: string } | undefined {
  const lit = literalsIn(lines[line]).find((l) => ch >= l.start && ch < l.end);
  if (lit) {
    const before = lines[line].slice(0, lit.start);
    const delimited = DELIMITED.exec(lit.text);
    if (lit.regexLiteral && looksLikeRegex(lit.text)) return { kind: "regex", text: lit.raw };
    if (delimited && looksLikeRegex(delimited[2]) && /preg_|regex|pattern/i.test(lines[line])) return { kind: "regex", text: lit.text };
    if (looksLikeRegex(lit.text) && (REGEX_CONTEXT.test(before) || /^[rR]/.test(lit.raw)) && sqlScore(lit.text) < 2) return { kind: "regex", text: lit.raw };
  }
  // SQL: solo si el puntero está en una cadena (o en un .sql / cadena multilínea) y la sentencia es SQL de verdad.
  if (!lit && languageId !== "sql" && !insideMultilineString(lines, line)) return undefined;
  const stmt = statementAround(lines, line);
  return looksLikeSql(stmt) ? { kind: "sql", text: stmt } : undefined;
}

function insideMultilineString(lines: string[], line: number): boolean {
  let open = false;
  for (let i = Math.max(0, line - 30); i < line; i++) {
    const n = (lines[i].match(/"""|'''|`/g) ?? []).length;
    if (n % 2) open = !open;
  }
  return open;
}

/**
 * La sentencia que contiene la línea: hacia arriba y abajo hasta un `;`, `{` o `}`.
 * Si la línea va armando una variable (`$query .= …`, `sql += …`), junta todas las
 * líneas seguidas que la arman.
 */
export function statementAround(lines: string[], line: number, max = 15): string {
  const target = /^\s*([$\w.>\-[\]'"]+?)\s*(?:\.=|\+=|=)(?!=)/.exec(lines[line])?.[1];
  const builds = (l: string) => target !== undefined && new RegExp(`^\\s*${target.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}\\s*(?:\\.=|\\+=|=)(?!=)`).test(l);
  let start = line;
  while (start > 0 && line - start < max && lines[start - 1].trim() && (builds(lines[start - 1]) || !/[;{}]\s*$/.test(lines[start - 1].trim()))) start--;
  let end = line;
  while (end < lines.length - 1 && end - line < max && lines[end + 1].trim() && (builds(lines[end + 1]) || !/;\s*$/.test(lines[end].trim()))) end++;
  return lines.slice(start, end + 1).join("\n").trim();
}

export function literalRequest(kind: LiteralKind, text: string, languageId: string, uiLanguage: string, names: Record<string, string>): ChatRequest {
  const lang = names[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  const system =
    kind === "sql"
      ? [
          `Explain the SQL query built in this ${languageId} code to a developer, in 1 to 3 short sentences:`,
          "which tables it touches, what it filters or changes and what it returns.",
          "If values are concatenated or interpolated into the SQL instead of using parameters, add one sentence warning about SQL injection.",
          "Plain text only, no markdown, do not repeat the code.",
          `Write in ${lang}.`,
        ]
      : [
          "Explain this regular expression to a developer.",
          "First line: one sentence saying what it matches.",
          "Then up to 5 lines, one per important part, formatted exactly as: part — meaning",
          "Plain text only, no markdown fences.",
          `Write in ${lang}.`,
        ];
  return { system: system.join("\n"), user: `Language: ${languageId}\n<code>\n${text}\n</code>`, maxTokens: 300, temperature: 0.1 };
}

/**
 * Detección de código duplicado por similitud de tokens entre funciones.
 * No usa IA: compara el vocabulario normalizado de cada bloque y agrupa los pares
 * que se parecen lo suficiente como para plantear extraer una función común.
 */

import { blockEnd, extractDeclarations } from "./declarations";
import { jaccard, tokenSet } from "./neighbors";

export interface SourceText {
  path: string;
  text: string;
}

export interface CodeUnit {
  path: string;
  name: string;
  line: number;
  end: number;
  text: string;
  tokens: Set<string>;
  /** Secuencias normalizadas (identificadores → ID) para comparar estructura. */
  structure: Set<string>;
}

export interface DuplicatePair {
  a: CodeUnit;
  b: CodeUnit;
  similarity: number;
}

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "new", "this", "self", "class", "import", "from", "export", "default", "async", "await", "try",
  "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "true", "false", "null", "undefined", "void",
  "public", "private", "protected", "static", "final", "def", "end", "then", "end", "nil", "None", "True", "False",
]);

/** Tokens útiles para comparar estructura, quitando palabras clave y nombres de 1 letra. */
function usefulTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of tokenSet(text)) {
    if (token.length < 2 || KEYWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

/**
 * Estructura con los nombres sustituidos por ID y los literales por STR/NUM:
 * así dos funciones clonadas con variables renombradas se reconocen.
 */
function structuralTokens(text: string): Set<string> {
  const normalized = text
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " STR ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " NUM ")
    .replace(/\b[A-Za-z_$][\w$]*\b/g, (word) => (KEYWORDS.has(word) ? word : "ID"))
    .replace(/\s+/g, " ")
    .trim();
  const parts = normalized.split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < parts.length - 1; i++) out.add(`${parts[i]} ${parts[i + 1]}`);
  return out;
}

/** Funciones del proyecto con al menos `minLines` líneas. */
export function codeUnits(files: SourceText[], minLines = 4, maxUnits = 6000): CodeUnit[] {
  const out: CodeUnit[] = [];
  for (const file of files) {
    if (out.length >= maxUnits || file.text.length > 300_000) break;
    const lines = file.text.split(/\r?\n/);
    for (const d of extractDeclarations(file.text)) {
      if (d.kind !== "function" || d.container) continue;
      const end = d.end ?? blockEnd(lines, d.line);
      if (end - d.line + 1 < minLines) continue;
      const text = lines.slice(d.line, end + 1).join("\n");
      const tokens = usefulTokens(text);
      const structure = structuralTokens(text);
      if (tokens.size < 5 || structure.size < 6 || text.length < 60) continue;
      out.push({ path: file.path, name: d.name, line: d.line, end, text, tokens, structure });
      if (out.length >= maxUnits) break;
    }
  }
  return out;
}

/** Pares de funciones parecidas, de más a menos similitud. */
export function findDuplicates(
  units: CodeUnit[],
  opts: { threshold?: number; maxPairs?: number; minShared?: number } = {},
): DuplicatePair[] {
  const threshold = opts.threshold ?? 0.78;
  const maxPairs = opts.maxPairs ?? 60;
  const minShared = opts.minShared ?? 4;
  // Índice invertido: solo comparamos funciones que comparten varios tokens.
  const byToken = new Map<string, number[]>();
  units.forEach((u, i) => {
    const keys = new Set([...u.tokens, ...[...u.structure].map((s) => `s:${s}`)]);
    for (const t of keys) {
      const list = byToken.get(t);
      if (list) list.push(i);
      else byToken.set(t, [i]);
    }
  });

  const shared = new Map<string, number>();
  for (const list of byToken.values()) {
    // Un patrón que aparece en demasiadas funciones no distingue nada y dispara el coste.
    if (list.length < 2 || list.length > 80) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}:${list[j]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs: DuplicatePair[] = [];
  for (const [key, count] of shared) {
    if (count < minShared) continue;
    const [i, j] = key.split(":").map(Number);
    const a = units[i];
    const b = units[j];
    if (!a || !b) continue;
    const sizeA = a.tokens.size;
    const sizeB = b.tokens.size;
    if (Math.min(sizeA, sizeB) / Math.max(sizeA, sizeB) < 0.4) continue;
    const names = jaccard(a.tokens, b.tokens);
    const shape = jaccard(a.structure, b.structure);
    // La estructura pesa más: los clones suelen cambiar los nombres de las variables.
    const similarity = shape * 0.7 + names * 0.3;
    if (similarity >= threshold) pairs.push({ a, b, similarity });
  }
  return pairs.sort((x, y) => y.similarity - x.similarity).slice(0, maxPairs);
}

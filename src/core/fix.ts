import type { ChatRequest } from "./types";

export interface Problem {
  /** Línea dentro del bloque (0-based). */
  line: number;
  message: string;
  severity: "error" | "warning";
  source?: string;
}

/** Petición para arreglar los problemas de un bloque de código cambiando lo mínimo. */
export function fixRequest(code: string, problems: Problem[], languageId: string, filePath: string, lang: string): ChatRequest {
  const lines = code.split("\n");
  const list = problems
    .map((p) => `- ${p.severity} on line ${p.line + 1}${p.source ? ` (${p.source})` : ""}: ${p.message}\n  line ${p.line + 1}: ${JSON.stringify(lines[p.line]?.trim() ?? "")}`)
    .join("\n");
  return {
    system: [
      `You fix ${languageId} code reported by a compiler or linter.`,
      "Return the WHOLE code block corrected, inside a single ``` fence, and after the fence ONE short sentence explaining the fix.",
      "Exact reply format:\n```\n<the whole corrected block>\n```\n<one sentence>",
      "Change as little as possible: keep every other line, comment, name and the indentation exactly as they are.",
      "Never add comments to the code. If you cannot fix it, return the block unchanged.",
      `Write the explanation sentence in ${lang}.`,
    ].join("\n"),
    user: `File: ${filePath}\nProblems (line numbers are relative to the block):\n${list}\n\n<block>\n${code}\n</block>`,
    maxTokens: Math.min(4000, 200 + Math.ceil(code.length / 2.5)),
    temperature: 0,
  };
}

const minIndent = (lines: string[]) =>
  Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length), Infinity);

/**
 * Extrae el código corregido y la explicación. Devuelve undefined si la respuesta
 * no parece un bloque completo (p. ej. el modelo solo devolvió la línea arreglada).
 */
export function parseFix(raw: string, original: string): { code: string; explanation: string } | undefined {
  // El bloque puede venir entre ```, entre <block>…</block>, o suelto (con la explicación antes o después).
  const fence = /```[^\n]*\n([\s\S]*?)\n?```/.exec(raw);
  const tags = /<block>\n?([\s\S]*?)\n?<\/block>/.exec(raw);
  let code: string;
  let explanation: string;
  if (tags) {
    // <block> es lo más específico (a veces viene incluso dentro de la ```).
    code = tags[1];
    explanation = (raw.slice(0, tags.index) + " " + raw.slice(tags.index + tags[0].length)).replace(/```\w*/g, " ");
  } else if (fence) {
    code = fence[1];
    explanation = raw.slice(0, fence.index) + " " + raw.slice(fence.index + fence[0].length);
  } else {
    // Sin delimitadores: quedarse con las líneas que parecen código del bloque original.
    const lines = raw.split("\n");
    const first = lines.findIndex((l) => similarLine(l, original));
    let last = lines.length - 1;
    while (last > first && !similarLine(lines[last], original)) last--;
    if (first < 0) return undefined;
    // Las líneas de cierre (`}`, `);`, `end`) también son parte del bloque.
    while (last + 1 < lines.length && /^\s*([)}\]]+[;,)]*|end|fi|done)\s*$/.test(lines[last + 1])) last++;
    code = lines.slice(first, last + 1).join("\n");
    explanation = [...lines.slice(0, first), ...lines.slice(last + 1)].join(" ");
  }
  code = code.replace(/^\s*<\/?block>\s*$/gm, "").replace(/^\n+|\s+$/g, "");
  explanation = explanation.replace(/<\/?block>/g, "").replace(/\s+/g, " ").trim().slice(0, 300);

  const origLines = original.replace(/\s+$/, "").split("\n");
  let lines = stripNewComments(code.split("\n"), original);
  if (!code.trim()) return undefined;
  // Un bloque muy recortado no es un arreglo del bloque, sino un trozo.
  if (origLines.length >= 6 && lines.length < origLines.length * 0.6) return undefined;
  // Algunos modelos quitan o añaden sangría a todo el bloque: realinearlo con el original.
  const want = minIndent(origLines);
  const got = minIndent(lines);
  if (want !== Infinity && got !== Infinity && want !== got) {
    const pad = /^[ \t]*/.exec(origLines.find((l) => l.trim() && /^[ \t]*/.exec(l)![0].length === want)!)![0];
    lines = lines.map((l) => (l.trim() ? pad + l.slice(got) : l));
  }
  return { code: lines.join("\n"), explanation };
}

/** ¿La línea (sin espacios) aparece casi igual en el bloque original? */
function similarLine(line: string, original: string): boolean {
  const t = line.replace(/\s+/g, "");
  if (t.length < 2) return false;
  return original
    .split("\n")
    .map((l) => l.replace(/\s+/g, ""))
    .some((o) => o === t || (t.length > 8 && o.length > 8 && (o.startsWith(t.slice(0, -2)) || t.startsWith(o.slice(0, -2)))));
}

/**
 * Quita comentarios al final de línea que el modelo añadió para "explicar" su cambio
 * (`foo(); // Añadido punto y coma`): no estaban en el original y ensucian el código.
 */
function stripNewComments(lines: string[], original: string): string[] {
  return lines.map((l) => {
    const m = /^(.*?[^\s])\s+(\/\/|#|--)\s?(.*)$/.exec(l);
    if (!m || /["'`]/.test(m[2]) || original.includes(`${m[2]} ${m[3]}`) || original.includes(`${m[2]}${m[3]}`)) return l;
    // No tocar si el "comentario" está dentro de una cadena (número impar de comillas antes).
    const quotes = (m[1].match(/["'`]/g) ?? []).length;
    return quotes % 2 ? l : m[1];
  });
}

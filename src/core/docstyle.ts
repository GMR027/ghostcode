import { commentLines } from "./prompt";
import type { ChatRequest } from "./types";

/**
 * «Documentar función»: el modelo solo aporta el contenido (JSON) y aquí se escribe
 * en el formato de documentación de cada lenguaje.
 */

export interface DocParam {
  name: string;
  type?: string;
  description: string;
}

export interface DocInfo {
  summary: string;
  params: DocParam[];
  returns?: { type?: string; description: string };
  throws?: string[];
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish", en: "English", pt: "Portuguese", fr: "French", de: "German", it: "Italian",
};
const LABELS: Record<string, { params: string; returns: string; throws: string }> = {
  es: { params: "Parámetros", returns: "Devuelve", throws: "Lanza" },
  en: { params: "Parameters", returns: "Returns", throws: "Throws" },
  pt: { params: "Parâmetros", returns: "Retorna", throws: "Lança" },
};

export function docRequest(code: string, kind: string, languageId: string, filePath: string, uiLanguage: string): ChatRequest {
  const lang = LANGUAGE_NAMES[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  return {
    system: [
      `You write reference documentation for a ${kind} written in ${languageId}.`,
      "Reply with ONLY a JSON object, no markdown fences, with this shape:",
      '{"summary": "ONE sentence on one line", "params": [{"name": "exact parameter name", "type": "type or empty", "description": "short"}],' +
        ' "returns": {"type": "type or empty", "description": "short"} or null, "throws": ["ExceptionType: when"]}',
      "Use the exact parameter names from the code (without $, *, & or type annotations). Infer types only if obvious.",
      'Use "returns": null when nothing is returned (constructors, procedures, classes).',
      `Write the descriptions in ${lang}.`,
    ].join("\n"),
    user: `File: ${filePath}\n<code>\n${code}\n</code>`,
    maxTokens: 500,
    temperature: 0.1,
  };
}

/** Parámetros de la firma (lo que haya dentro del primer par de paréntesis). */
export function signatureParams(signature: string, languageId = ""): string[] {
  const go = languageId === "go";
  // Go: `func (s *Server) Start(...)`: el primer paréntesis es el receptor.
  if (go) signature = signature.replace(/^\s*func\s*\([^)]*\)/, "func");
  const open = signature.indexOf("(");
  if (open < 0) return [];
  let depth = 0;
  let current = "";
  const parts: string[] = [];
  for (const ch of signature.slice(open + 1)) {
    if ("([{<".includes(ch)) depth++;
    if (")]}>".includes(ch)) {
      if (depth === 0) break;
      depth--;
    }
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts
    .map((p) =>
      p
        .replace(/=.*$/s, "") // valor por defecto
        .replace(/^\s*(?:(?:public|private|protected|readonly|final|const|var|val|let|mut|ref|out|in|inout|params|override|required)\s+)+/, "")
        .trim(),
    )
    .map((p) => {
      // "name: Type" (TS, Python, Rust, Kotlin, Swift, Go-ish) o "Type name" (C, Java, C#, PHP con tipo).
      const colon = /^([*&$]*[A-Za-z_][\w]*)\s*\??\s*:/.exec(p);
      if (colon) return colon[1];
      const ids = p.match(/[$]?[A-Za-z_][\w]*/g);
      if (!ids) return "";
      // Go escribe "nombre Tipo"; C, Java, C#, PHP… "Tipo nombre".
      return go ? ids[0] : ids[ids.length - 1];
    })
    .map((n) => n.replace(/^[$*&]+/, ""))
    .filter((n) => n && !/^(self|cls|this|_)$/.test(n) && n !== "void");
}

/** Extrae el JSON de la respuesta; si no es JSON válido, usa el texto como resumen. */
export function parseDocInfo(raw: string, params: string[]): DocInfo {
  let data: Partial<DocInfo> & { returns?: unknown } = {};
  const json = /\{[\s\S]*\}/.exec(raw.replace(/```(?:json)?/g, ""));
  try {
    if (json) data = JSON.parse(json[0]);
  } catch {
    data = {};
  }
  const summary = String(data.summary ?? "").trim() || raw.replace(/```[\s\S]*?```/g, "").replace(/\s+/g, " ").trim().slice(0, 300);
  const given = Array.isArray(data.params) ? data.params : [];
  // Los nombres salen siempre de la firma real; el modelo solo aporta descripciones.
  const out: DocParam[] = params.map((name) => {
    const p = given.find((g) => String(g?.name ?? "").replace(/^[$*&]+/, "").toLowerCase() === name.toLowerCase());
    return { name, type: p?.type ? String(p.type) : undefined, description: String(p?.description ?? "").trim() };
  });
  const r = data.returns as { type?: unknown; description?: unknown } | null | undefined;
  const returns =
    r && typeof r === "object" && String(r.description ?? "").trim()
      ? { type: r.type ? String(r.type) : undefined, description: String(r.description).trim() }
      : undefined;
  const throws = Array.isArray(data.throws) ? data.throws.map(String).filter(Boolean) : undefined;
  return { summary, params: out, returns, throws: throws?.length ? throws : undefined };
}

type Style =
  | "jsdoc" | "tsdoc" | "phpdoc" | "javadoc" | "doxygen" | "csharp" | "rust" | "swift" | "dart"
  | "go" | "python" | "ruby" | "lua" | "elixir" | "roxygen" | "plain";

const STYLES: Record<string, Style> = {
  javascript: "jsdoc", javascriptreact: "jsdoc", vue: "jsdoc", svelte: "jsdoc",
  typescript: "tsdoc", typescriptreact: "tsdoc",
  php: "phpdoc",
  java: "javadoc", kotlin: "javadoc", scala: "javadoc", groovy: "javadoc",
  c: "doxygen", cpp: "doxygen", "objective-c": "doxygen", "objective-cpp": "doxygen", cuda: "doxygen",
  csharp: "csharp", rust: "rust", swift: "swift", dart: "dart", go: "go", python: "python",
  ruby: "ruby", lua: "lua", elixir: "elixir", r: "roxygen",
};

export function docStyle(languageId: string): Style {
  return STYLES[languageId] ?? "plain";
}

function wrap(text: string, width = Infinity): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

const t = (type?: string) => (type ? type.trim() : "");

/**
 * Líneas de documentación (sin sangría) para `languageId`. En Python es un docstring
 * que va dentro de la función; en el resto, un comentario encima de la declaración.
 */
export function renderDoc(languageId: string, info: DocInfo, name: string, uiLanguage = "es"): { lines: string[]; inside: boolean } {
  const style = docStyle(languageId);
  const L = LABELS[uiLanguage.slice(0, 2)] ?? LABELS.en;
  const summary = wrap(info.summary);
  const block = (body: string[]) => ["/**", ...body.map((l) => (l ? ` * ${l}` : " *")), " */"];
  const prefixed = (p: string, body: string[]) => body.map((l) => (l ? `${p} ${l}` : p));
  const tags: string[] = [];

  switch (style) {
    case "jsdoc":
    case "tsdoc":
    case "phpdoc":
    case "javadoc":
    case "doxygen": {
      for (const p of info.params) {
        const type = t(p.type);
        const n = style === "phpdoc" ? `$${p.name}` : p.name;
        if (style === "jsdoc") tags.push(`@param ${type ? `{${type}} ` : ""}${n}${p.description ? ` - ${p.description}` : ""}`);
        else if (style === "tsdoc") tags.push(`@param ${n}${p.description ? ` - ${p.description}` : ""}`);
        else if (style === "phpdoc") tags.push(`@param ${type || "mixed"} ${n}${p.description ? ` ${p.description}` : ""}`);
        else tags.push(`@param ${n}${p.description ? ` ${p.description}` : ""}`);
      }
      if (info.returns) {
        const type = t(info.returns.type);
        if (style === "jsdoc") tags.push(`@returns ${type ? `{${type}} ` : ""}${info.returns.description}`);
        else if (style === "phpdoc") tags.push(`@return ${type || "mixed"} ${info.returns.description}`);
        else tags.push(`${style === "tsdoc" ? "@returns" : "@return"} ${info.returns.description}`);
      }
      for (const e of info.throws ?? []) tags.push(`@throws ${e}`);
      return { lines: block(tags.length ? [...summary, "", ...tags] : summary), inside: false };
    }
    case "csharp": {
      const out = ["<summary>", ...summary, "</summary>"];
      for (const p of info.params) out.push(`<param name="${p.name}">${p.description}</param>`);
      if (info.returns) out.push(`<returns>${info.returns.description}</returns>`);
      for (const e of info.throws ?? []) out.push(`<exception cref="${e.split(/[:\s]/)[0]}">${e.replace(/^[^:\s]+[:\s]*/, "")}</exception>`);
      return { lines: prefixed("///", out), inside: false };
    }
    case "rust": {
      const out = [...summary];
      if (info.params.length) out.push("", "# Arguments", "", ...info.params.map((p) => `* \`${p.name}\` - ${p.description}`));
      if (info.returns) out.push("", "# Returns", "", info.returns.description);
      if (info.throws?.length) out.push("", "# Errors", "", ...info.throws);
      return { lines: prefixed("///", out), inside: false };
    }
    case "swift": {
      const out = [...summary];
      if (info.params.length) out.push("", "- Parameters:", ...info.params.map((p) => `  - ${p.name}: ${p.description}`));
      if (info.returns) out.push(`- Returns: ${info.returns.description}`);
      if (info.throws?.length) out.push(`- Throws: ${info.throws.join("; ")}`);
      return { lines: prefixed("///", out), inside: false };
    }
    case "dart": {
      const out = [...summary];
      for (const p of info.params) if (p.description) out.push("", `[${p.name}]: ${p.description}`);
      if (info.returns) out.push("", `${L.returns}: ${info.returns.description}`);
      return { lines: prefixed("///", out), inside: false };
    }
    case "go": {
      // Convención de Go: el comentario empieza por el nombre.
      const first = summary.length ? wrap(`${name} ${info.summary.replace(/^\w/, (c) => c.toLowerCase())}`) : [name];
      return { lines: prefixed("//", first), inside: false };
    }
    case "python": {
      const out = [...summary];
      if (info.params.length) out.push("", "Args:", ...info.params.map((p) => `    ${p.name}${t(p.type) ? ` (${t(p.type)})` : ""}: ${p.description}`));
      if (info.returns) out.push("", "Returns:", `    ${t(info.returns.type) ? `${t(info.returns.type)}: ` : ""}${info.returns.description}`);
      if (info.throws?.length) out.push("", "Raises:", ...info.throws.map((e) => `    ${e}`));
      if (out.length === 1) return { lines: [`"""${out[0]}"""`], inside: true };
      return { lines: [`"""${out[0]}`, ...out.slice(1), '"""'], inside: true };
    }
    case "ruby": {
      const out = [...summary];
      for (const p of info.params) out.push(`@param ${p.name} ${t(p.type) ? `[${t(p.type)}] ` : ""}${p.description}`);
      if (info.returns) out.push(`@return ${t(info.returns.type) ? `[${t(info.returns.type)}] ` : ""}${info.returns.description}`);
      return { lines: prefixed("#", out), inside: false };
    }
    case "lua": {
      const out = summary.map((l) => `--- ${l}`);
      for (const p of info.params) out.push(`---@param ${p.name} ${t(p.type) || "any"} ${p.description}`);
      if (info.returns) out.push(`---@return ${t(info.returns.type) || "any"} # ${info.returns.description}`);
      return { lines: out, inside: false };
    }
    case "elixir": {
      const out = [...summary];
      if (info.params.length) out.push("", `## ${L.params}`, "", ...info.params.map((p) => `  * \`${p.name}\` - ${p.description}`));
      if (info.returns) out.push("", `${L.returns}: ${info.returns.description}`);
      return { lines: ['@doc """', ...out, '"""'], inside: false };
    }
    case "roxygen": {
      const out = [...summary];
      for (const p of info.params) out.push(`@param ${p.name} ${p.description}`);
      if (info.returns) out.push(`@return ${info.returns.description}`);
      return { lines: prefixed("#'", out), inside: false };
    }
    default: {
      // Cualquier otro lenguaje: comentario normal con secciones legibles.
      const out = [...summary];
      if (info.params.length) out.push(`${L.params}:`, ...info.params.map((p) => `  ${p.name}${p.description ? ` — ${p.description}` : ""}`));
      if (info.returns) out.push(`${L.returns}: ${info.returns.description}`);
      if (info.throws?.length) out.push(`${L.throws}: ${info.throws.join("; ")}`);
      return { lines: commentLines(languageId, out.join("\n")).split("\n"), inside: false };
    }
  }
}

/**
 * Documentación que ya existe para la declaración en `declLine` (encima, o el docstring
 * de Python dentro). Devuelve el rango de líneas [inicio, fin] o undefined.
 */
export function existingDoc(lines: string[], declLine: number, languageId: string, bodyStart?: number): [number, number] | undefined {
  if (docStyle(languageId) === "python" && bodyStart !== undefined) {
    let i = bodyStart;
    while (i < lines.length && !lines[i].trim()) i++;
    const m = /^\s*[rRuU]?("""|''')/.exec(lines[i] ?? "");
    if (!m) return undefined;
    const rest = lines[i].trim().slice(m[0].trim().length);
    if (rest.includes(m[1])) return [i, i];
    for (let j = i + 1; j < lines.length; j++) if (lines[j].includes(m[1])) return [i, j];
    return undefined;
  }
  let end = annotationsStart(lines, declLine) - 1;
  if (end < 0) return undefined;
  const last = lines[end].trim();
  if (last.endsWith("*/")) {
    for (let i = end; i >= 0; i--) if (/^\s*\/\*/.test(lines[i])) return [i, end];
    return undefined;
  }
  const marker = /^\s*(\/\/\/|\/\/|#'|---|#|--)/.exec(lines[end])?.[1];
  if (!marker || (marker === "//" && docStyle(languageId) !== "go")) return undefined;
  let start = end;
  while (start > 0 && lines[start - 1].trimStart().startsWith(marker)) start--;
  return [start, end];
}

/** Primera línea de los decoradores/atributos que preceden a la declaración (@Override, #[derive], [Attr]). */
export function annotationsStart(lines: string[], declLine: number): number {
  let i = declLine;
  while (i > 0 && /^\s*(@[\w.]+|#\[|\[[A-Z][\w.]*(\(|\]))/.test(lines[i - 1])) i--;
  return i;
}

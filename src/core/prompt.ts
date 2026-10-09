import type { CompletionRequest, Snippet } from "./types";

const HASH_LANGS = new Set([
  "python", "shellscript", "ruby", "perl", "r", "yaml", "toml", "makefile", "dockerfile",
  "powershell", "coffeescript", "julia", "elixir", "nim", "crystal", "cmake", "properties",
]);
const DASH_LANGS = new Set(["sql", "lua", "haskell", "elm", "ada", "vhdl"]);
const XML_LANGS = new Set(["html", "xml", "vue", "svelte", "xsl", "astro"]);
const PERCENT_LANGS = new Set(["latex", "tex", "matlab", "erlang", "bibtex"]);
const SEMI_LANGS = new Set(["clojure", "lisp", "scheme", "ini"]);

/** Convierte cada línea de `text` en un comentario del lenguaje dado. */
export function commentLines(languageId: string, text: string): string {
  const lines = text.split("\n");
  let wrap: (l: string) => string;
  if (HASH_LANGS.has(languageId)) wrap = (l) => `# ${l}`;
  else if (DASH_LANGS.has(languageId)) wrap = (l) => `-- ${l}`;
  else if (XML_LANGS.has(languageId)) wrap = (l) => `<!-- ${l.replace(/--/g, "- -")} -->`;
  else if (PERCENT_LANGS.has(languageId)) wrap = (l) => `% ${l}`;
  else if (SEMI_LANGS.has(languageId)) wrap = (l) => `; ${l}`;
  else if (languageId === "css") wrap = (l) => `/* ${l.replace(/\*\//g, "* /")} */`;
  else wrap = (l) => `// ${l}`;
  return lines.map(wrap).join("\n");
}

/**
 * Cabecera estilo Copilot que se antepone al prefijo en los modelos FIM:
 * ruta del archivo + fragmentos relevantes de otras pestañas, todo como comentarios.
 */
export function buildFimHeader(filePath: string, languageId: string, snippets: Snippet[], style?: string): string {
  const parts: string[] = [`Path: ${filePath}`];
  if (style) parts.push(`Style: ${style}`);
  for (const s of snippets) {
    parts.push(`Compare this snippet from ${s.path}:`);
    parts.push(...s.text.replace(/\s+$/, "").split("\n"));
  }
  // JSON no admite comentarios: solo la ruta tampoco, así que no ponemos nada.
  if (languageId === "json") return "";
  return commentLines(languageId, parts.join("\n")) + "\n";
}

/** Prefijo completo para modelos FIM (cabecera + código antes del cursor). */
export function buildFimPrompt(req: CompletionRequest): string {
  return buildFimHeader(req.filePath, req.languageId, req.snippets, req.style) + req.prefix;
}

export const CURSOR = "<CURSOR>";

/** System prompt para modelos de chat (Claude, GPT...). */
export function chatSystemPrompt(multiline: boolean): string {
  return [
    "You are a code autocompletion engine embedded in a code editor, like GitHub Copilot.",
    `The user's file is given with the cursor marked as ${CURSOR}.`,
    `Reply with ONLY the exact text that should be inserted at ${CURSOR} — nothing else.`,
    "Never repeat code that already appears before or after the cursor.",
    "No markdown fences, no explanations, no comments about what you did.",
    "Match the file's indentation, style and language.",
    multiline
      ? "You may write several lines, but stop at the end of the current logical block (function body, statement, etc.)."
      : "Complete ONLY the rest of the current line. Do not add a newline.",
    "If nothing sensible should be inserted, reply with an empty message.",
  ].join("\n");
}

/** Mensaje de usuario para modelos de chat. */
export function chatUserPrompt(req: CompletionRequest): string {
  const parts: string[] = [];
  if (req.snippets.length) {
    parts.push("Related code from other open files (for reference only):");
    for (const s of req.snippets) {
      parts.push(`<snippet path="${s.path}">\n${s.text.replace(/\s+$/, "")}\n</snippet>`);
    }
    parts.push("");
  }
  if (req.style) parts.push(`Developer's style (imitate it): ${req.style}`, "");
  parts.push(`File: ${req.filePath} (language: ${req.languageId})`);
  parts.push("<file>");
  parts.push(`${req.prefix}${CURSOR}${req.suffix}`);
  parts.push("</file>");
  parts.push(`Text to insert at ${CURSOR}:`);
  return parts.join("\n");
}

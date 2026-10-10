import type { ChatRequest } from "./types";

/** Petición para explicar un fragmento de código y revisarlo en busca de errores y fallas de seguridad. */
export function assistantRequest(code: string, languageId: string, lang: string): ChatRequest {
  return {
    system: [
      "You are a senior developer and security reviewer. The user pastes a piece of code.",
      "Reply in Markdown with exactly these three sections, using these headings:",
      "## Qué hace\nWhat the code does and how, in a few short sentences (bullets for the steps if useful).",
      "## Errores\nBugs, edge cases or bad practices, as bullets citing the line or expression. Write \"Ninguno evidente.\" if there are none.",
      "## Seguridad\nSecurity flaws (injection, XSS, unsafe input, secrets, weak crypto, path traversal, unsafe deserialization…), as bullets with the risk and a one-line fix. Write \"Ninguna evidente.\" if there are none.",
      "Be precise: only report problems that really exist in the given code. Do not rewrite the whole code.",
      `Write in ${lang}, keeping the three headings exactly as shown above.`,
    ].join("\n"),
    user: `Language: ${languageId}\n<code>\n${code}\n</code>`,
    maxTokens: 1200,
    temperature: 0.2,
  };
}

/** Quita vallas envolventes que algunos modelos ponen alrededor de toda la respuesta. */
export function cleanAssistantReply(raw: string): string {
  return raw.replace(/^\s*```(?:markdown|md)?\n/, "").replace(/\n```\s*$/, "").trim();
}

/** Lenguaje probable de un trozo de código pegado (para dar contexto al modelo). */
export function guessLanguage(code: string, fallback: string): string {
  if (/^\s*<\?php/m.test(code)) return "php";
  if (/^\s*(def |import \w+$|from \w+ import|print\()/m.test(code)) return "python";
  if (/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(code) && !/[{};]/.test(code)) return "sql";
  if (/^\s*#include\b/m.test(code)) return "c/c++";
  if (/\b(public|private) (static )?(class|void)\b/.test(code)) return "java";
  if (/\b(const|let|var|function)\b|=>/.test(code)) return "javascript/typescript";
  return fallback;
}

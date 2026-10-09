import type { ChatRequest } from "./types";

export type Convention = "camel" | "pascal" | "snake" | "screaming" | "kebab";

/** Palabras de un identificador en cualquier formato: obtenerUsuario, get_user, HTTPServer, mi-func. */
export function splitWords(name: string): string[] {
  return name
    .replace(/[^\p{L}\p{N}_\s\-.$@]/gu, " ")
    .trim()
    .replace(/^[$@_]+|[_$]+$/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function conventionOf(name: string): Convention | undefined {
  const n = name.replace(/^[$@_]+/, "");
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(n)) return "camel";
  if (/^([A-Z][a-z0-9]+){2,}$/.test(n)) return "pascal";
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)) return "snake";
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(n)) return "screaming";
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(n)) return "kebab";
  return undefined;
}

/** La convención más usada entre `names` (las funciones del archivo); `fallback` si no hay datos. */
export function detectConvention(names: string[], fallback: Convention = "camel"): Convention {
  const counts = new Map<Convention, number>();
  for (const n of names) {
    const c = conventionOf(n);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: Convention = fallback;
  let max = 0;
  for (const [c, n] of counts) if (n > max) [best, max] = [c, n];
  return best;
}

export function toConvention(name: string, conv: Convention): string {
  const words = splitWords(name);
  if (!words.length) return name;
  switch (conv) {
    case "camel":
      return words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
    case "pascal":
      return words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
    case "snake":
      return words.join("_");
    case "screaming":
      return words.join("_").toUpperCase();
    case "kebab":
      return words.join("-");
  }
}

export function renameRequest(code: string, name: string, kind: string, languageId: string, uiLanguage: string): ChatRequest {
  return {
    system: [
      `Suggest better names for the ${kind} \`${name}\` written in ${languageId}, based on what it actually does.`,
      'Reply with ONLY a JSON array of 3 objects: [{"name": "suggestedName", "reason": "short reason"}].',
      "Names must be descriptive verbs/nouns, concise (1-4 words), valid identifiers, and different from the current name.",
      "Use the same natural language as the existing identifiers in the code (e.g. Spanish names if the code uses Spanish).",
      `Write the reasons in ${uiLanguage}.`,
    ].join("\n"),
    user: `<code>\n${code}\n</code>`,
    maxTokens: 250,
    temperature: 0.3,
  };
}

export interface NameSuggestion {
  name: string;
  reason: string;
}

/** Nombres sugeridos, en la convención del archivo, válidos y sin repetir el actual. */
export function parseRenameSuggestions(raw: string, current: string, conv: Convention): NameSuggestion[] {
  let items: { name?: unknown; reason?: unknown }[] = [];
  const json = /\[[\s\S]*\]/.exec(raw.replace(/```(?:json)?/g, ""));
  try {
    if (json) items = JSON.parse(json[0]);
  } catch {
    items = [];
  }
  if (!items.length) {
    // Sin JSON: una sugerencia por línea ("1. nombre — razón").
    items = raw
      .split("\n")
      .map((l) => /^\s*(?:[-*\d.)]+\s*)?`?([A-Za-z_$][\w$-]*)`?\s*(?:[-—:]\s*(.*))?$/.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => ({ name: m[1], reason: m[2] ?? "" }));
  }
  const prefix = /^[$@_]+/.exec(current)?.[0] ?? "";
  const out: NameSuggestion[] = [];
  for (const it of items) {
    if (typeof it?.name !== "string") continue;
    const name = prefix + toConvention(it.name, conv);
    if (!/^[\p{L}_$@][\p{L}\p{N}_$]*$/u.test(name) || name === current || out.some((o) => o.name === name)) continue;
    out.push({ name, reason: String(it.reason ?? "").trim() });
  }
  return out.slice(0, 5);
}

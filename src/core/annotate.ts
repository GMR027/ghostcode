import type { ChatRequest } from "./types";

export const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish", en: "English", pt: "Portuguese", fr: "French", de: "German", it: "Italian",
};

/**
 * Idioma de las anotaciones. "auto": el de VS Code, salvo que sea el inglés por defecto
 * (sin paquete de idioma), en cuyo caso manda el del sistema (p. ej. LANG=es_MX.UTF-8).
 */
export function resolveAnnotationLanguage(setting: string, uiLanguage: string, env: Record<string, string | undefined>): string {
  if (setting !== "auto") return setting;
  if (!uiLanguage.toLowerCase().startsWith("en")) return uiLanguage;
  const sys = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^[a-z]{2}/i.test(sys) && !/^(C|POSIX)\b/.test(sys) ? sys.slice(0, 2).toLowerCase() : uiLanguage;
}

/** Petición para explicar un fragmento de código en `uiLanguage` (p. ej. "es", "en-us"). */
export function annotationRequest(code: string, languageId: string, filePath: string, uiLanguage: string): ChatRequest {
  const lang = LANGUAGE_NAMES[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  return {
    system: [
      "You are a senior developer writing a short explanatory comment for a code excerpt.",
      "Explain what the code does and, if not obvious, how or why — in ONE single sentence on ONE single line.",
      "Plain text only: no markdown, no code fences, no comment markers, do not repeat the code.",
      `Write in ${lang}.`,
    ].join("\n"),
    user: `File: ${filePath} (language: ${languageId})\n<code>\n${code}\n</code>`,
    maxTokens: 300,
    temperature: 0.2,
  };
}

/** Petición para explicar en 1–3 frases qué hace un símbolo (función, clase…) al pasar el puntero. */
export function explainRequest(
  code: string,
  kind: string,
  name: string,
  languageId: string,
  filePath: string,
  uiLanguage: string,
): ChatRequest {
  const lang = LANGUAGE_NAMES[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  return {
    system: [
      `You explain code to a developer who is hovering over the ${kind} \`${name}\` in their editor.`,
      "In 1 to 3 short sentences say what it does or represents and, if useful, what it returns or its side effects.",
      "Plain text only: no markdown headings, no code fences, do not repeat the code or start with its name.",
      `Write in ${lang}.`,
    ].join("\n"),
    user: `File: ${filePath} (language: ${languageId})\n<code>\n${code}\n</code>`,
    maxTokens: 200,
    temperature: 0.2,
  };
}

/**
 * Limpia la respuesta del modelo y la parte en líneas de como mucho `width`
 * caracteres, sin líneas vacías (se convertirán en comentarios).
 */
export function formatAnnotation(raw: string, width = 90, maxLines = 12): string[] {
  const text = raw
    .split("\n")
    .filter((l) => !/^\s*```/.test(l))
    .map((l) =>
      l
        .trim()
        // Marcadores de comentario que el modelo haya añadido por su cuenta.
        .replace(/^(\/\/+|#+(?!\w)|--(?!-)|\/\*+|\*+\/?|<!--|;+)\s*/, "")
        .replace(/\s*(\*\/|-->)$/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .trim(),
    )
    .filter(Boolean);

  const lines: string[] = [];
  for (const para of text) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if (line && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, maxLines);
}

/** Las primeras `n` frases de `text` (los modelos pequeños no siempre respetan el límite pedido). */
export function firstSentences(text: string, n: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  // Fin de frase: . ! ? seguidos de espacio y mayúscula (no "e.g. x" ni "v1.5 b").
  const re = /[.!?](?=\s+[A-ZÁÉÍÓÚÑ¿¡"'`(])/g;
  let count = 0;
  for (let m = re.exec(flat); m; m = re.exec(flat)) {
    if (++count === n) return flat.slice(0, m.index + 1);
  }
  return flat;
}

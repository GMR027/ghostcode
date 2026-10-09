import { blockEnd, extractDeclarations } from "./declarations";
import { detectIndentUnit } from "./indent";
import { detectConvention, type Convention } from "./naming";
import type { ChatRequest } from "./types";

/**
 * «Halo IA»: perfil de cómo escribe código el usuario, medido sobre sus archivos
 * (no adivinado por el modelo).
 */
export interface StyleProfile {
  files: number;
  functions: number;
  indent: { unit: number; tabs: boolean };
  quotes?: "single" | "double";
  semicolons?: boolean;
  naming?: Convention;
  braces?: "same-line" | "next-line";
  commentLanguage?: "es" | "en";
  /** % de líneas que son comentarios. */
  commentRatio: number;
  avgFunctionLines: number;
}

export interface SourceFile {
  path: string;
  text: string;
}

const COMMENT_RE = /^\s*(\/\/|#(?!include|!|\[)|\/\*|\*|--|;)/;
const ES = /\b(el|la|los|las|de|del|que|para|con|por|una?|se|si|al|es|lo|como|cuando|esta|este)\b/gi;
const EN = /\b(the|to|of|and|is|for|this|that|if|with|when|it|be|are|from|on|as|an)\b/gi;

const ratio = (a: number, b: number) => (a + b ? a / (a + b) : 0.5);

export function analyzeStyle(files: SourceFile[]): StyleProfile {
  let tabs = 0;
  let spaces = 0;
  let single = 0;
  let double = 0;
  let withSemi = 0;
  let withoutSemi = 0;
  let sameLine = 0;
  let nextLine = 0;
  let es = 0;
  let en = 0;
  let commentLines = 0;
  let codeLines = 0;
  const names: string[] = [];
  const lengths: number[] = [];
  const sample: string[] = [];

  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    const isJs = /\.(m?[jt]sx?|cjs)$/.test(f.path);
    for (const line of lines) {
      if (!line.trim()) continue;
      if (COMMENT_RE.test(line)) {
        commentLines++;
        es += (line.match(ES) ?? []).length;
        en += (line.match(EN) ?? []).length;
        continue;
      }
      codeLines++;
      if (sample.length < 4000) sample.push(line);
      if (/^\t/.test(line)) tabs++;
      else if (/^ {2}/.test(line)) spaces++;
      const code = line.replace(/\/\/.*$/, "");
      single += (code.match(/'[^'\n]*'/g) ?? []).length;
      double += (code.match(/"[^"\n]*"/g) ?? []).length;
      if (isJs && /[\w)\]'"`]\s*;?\s*$/.test(code) && !/^\s*(if|for|while|else|function|class|import|export\s+(default\s+)?(function|class))\b/.test(code)) {
        if (/;\s*$/.test(code)) withSemi++;
        else if (!/[{(,[]\s*$/.test(code)) withoutSemi++;
      }
    }
    for (const d of extractDeclarations(f.text)) {
      if (d.kind !== "function") continue;
      names.push(d.name);
      const end = d.end ?? blockEnd(lines, d.line);
      lengths.push(end - d.line + 1);
      if (/\{\s*$/.test(lines[d.line])) sameLine++;
      else if (/^\s*\{\s*$/.test(lines[d.line + 1] ?? "")) nextLine++;
    }
  }

  const profile: StyleProfile = {
    files: files.length,
    functions: names.length,
    indent: { unit: detectIndentUnit(sample), tabs: tabs > spaces },
    commentRatio: Math.round((100 * commentLines) / Math.max(1, commentLines + codeLines)),
    avgFunctionLines: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
  };
  if (single + double >= 10) {
    const r = ratio(single, double);
    if (r > 0.65) profile.quotes = "single";
    if (r < 0.35) profile.quotes = "double";
  }
  if (withSemi + withoutSemi >= 8) profile.semicolons = ratio(withSemi, withoutSemi) > 0.5;
  if (names.length >= 3) profile.naming = detectConvention(names);
  if (sameLine + nextLine >= 3) profile.braces = sameLine >= nextLine ? "same-line" : "next-line";
  if (es + en >= 10) profile.commentLanguage = es > en ? "es" : "en";
  return profile;
}

const NAMING_LABEL: Record<Convention, string> = {
  camel: "camelCase", pascal: "PascalCase", snake: "snake_case", screaming: "MAYÚSCULAS", kebab: "kebab-case",
};

/** Etiquetas cortas para el panel. */
export function describeStyle(p: StyleProfile): string[] {
  const out = [p.indent.tabs ? "tabulaciones" : `${p.indent.unit} espacios`];
  if (p.quotes) out.push(p.quotes === "single" ? "comillas simples" : "comillas dobles");
  if (p.semicolons !== undefined) out.push(p.semicolons ? "con punto y coma" : "sin punto y coma");
  if (p.naming) out.push(NAMING_LABEL[p.naming]);
  if (p.braces) out.push(p.braces === "same-line" ? "llave en la misma línea" : "llave en línea aparte");
  if (p.commentLanguage) out.push(`comentarios en ${p.commentLanguage === "es" ? "español" : "inglés"} (${p.commentRatio}%)`);
  if (p.avgFunctionLines) out.push(`funciones de ~${p.avgFunctionLines} líneas`);
  return out;
}

/** Una línea en inglés para los prompts (cabecera del autocompletado, herramientas). */
export function styleHint(p: StyleProfile): string {
  const parts = [p.indent.tabs ? "tab indentation" : `${p.indent.unit}-space indentation`];
  if (p.quotes) parts.push(`${p.quotes} quotes`);
  if (p.semicolons !== undefined) parts.push(p.semicolons ? "semicolons" : "no semicolons");
  if (p.naming) parts.push(`${NAMING_LABEL[p.naming]} names`);
  if (p.braces) parts.push(p.braces === "same-line" ? "opening brace on the same line" : "opening brace on its own line");
  if (p.commentLanguage) parts.push(`comments in ${p.commentLanguage === "es" ? "Spanish" : "English"}`);
  return parts.join(", ");
}

export function haloSummaryRequest(samples: string[], hint: string, lang: string): ChatRequest {
  return {
    system: [
      "You study how a developer writes code, to help an autocomplete tool imitate them.",
      "From the code samples, write 5 to 8 short bullet points about their habits: naming, how they structure functions,",
      "error handling and validation, comments, libraries/APIs they rely on, and recurring patterns.",
      "Be concrete (mention real names and patterns seen). No introduction, only the bullets ('- ...').",
      `Measured style: ${hint}.`,
      `Write in ${lang}.`,
    ].join("\n"),
    user: samples.map((s, i) => `<sample ${i + 1}>\n${s}\n</sample>`).join("\n\n"),
    maxTokens: 500,
    temperature: 0.2,
  };
}

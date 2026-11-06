/**
 * Adapta un fragmento pegado al estilo del archivo: sangría, tabulaciones o
 * espacios, comillas, punto y coma y fin de línea. No reformatea ni reordena
 * nada: solo normaliza lo que se acaba de pegar para que encaje.
 */

export interface StyleRules {
  indentUnit: number;
  tabs: boolean;
  quotes: "single" | "double" | "keep";
  semicolons?: boolean;
  eol: "\n" | "\r\n";
}

export interface AdaptResult {
  text: string;
  changes: string[];
}

const JS = /\.(m?[jt]sx?|cjs|vue|svelte|astro)$/i;
const SCRIPT_LANG = /^(javascript|typescript|javascriptreact|typescriptreact|vue|svelte|astro|coffeescript)$/i;
const isScript = (languageId: string) => JS.test(languageId) || SCRIPT_LANG.test(languageId);

/** Deduce el estilo dominante del texto del documento. */
export function detectStyle(text: string, languageId = ""): StyleRules {
  const lines = text.split(/\r?\n/);
  let tabs = 0;
  let spaces = 0;
  const units: number[] = [];
  let single = 0;
  let double = 0;
  let semi = 0;
  let noSemi = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = /^[\t ]*/.exec(line)![0];
    if (lead.includes("\t")) tabs++;
    else if (lead.length) {
      spaces++;
      units.push(lead.length);
    }
    const code = line.replace(/\/\/.*$/, "").replace(/#(?!\[).*$/, "");
    single += (code.match(/(?:^|[^\\])'(?:[^'\\]|\\.)*'/g) ?? []).length;
    double += (code.match(/(?:^|[^\\])"(?:[^"\\]|\\.)*"/g) ?? []).length;
    if (/[;]\s*(?:\/\/.*)?$/.test(code)) semi++;
    else if (/[\w)\]'"`]\s*(?:\/\/.*)?$/.test(code) && !/[{(:,]\s*$/.test(code)) noSemi++;
  }

  // MCD de las sangrías: 2, 4 u 8 espacios son los casos reales.
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const unit = units.length ? Math.max(1, Math.min(8, units.reduce((a, b) => gcd(a, b)))) : 2;
  const isJs = isScript(languageId);
  return {
    indentUnit: [1, 2, 4, 8].includes(unit) ? unit : 2,
    tabs: tabs > spaces,
    quotes: single + double >= 6 ? (single > double ? "single" : "double") : "keep",
    semicolons: isJs && semi + noSemi >= 6 ? semi > noSemi : undefined,
    eol: /\r\n/.test(text) ? "\r\n" : "\n",
  };
}

function convertQuotes(line: string, target: "single" | "double"): string {
  const from = target === "single" ? '"' : "'";
  const to = target === "single" ? "'" : '"';
  return line.replace(new RegExp(`${from}((?:\\\\.|[^${from}\\\\])*)${from}`, "g"), (whole, content: string) => {
    // No convertir si el contenido lleva la comilla destino sin escapar.
    if (content.includes(to)) return whole;
    // Desescapar la comilla que deja de ser especial y escapar la nueva.
    const body = content.replace(new RegExp(`\\\\${from}`, "g"), from).replace(new RegExp(`(^|[^\\\\])${to}`, "g"), `$1\\${to}`);
    return `${to}${body}${to}`;
  });
}

const STATEMENT_START = /^\s*(?:import|export|const|let|var|return|throw|break|continue|await|yield|type|interface)\b/;
const NO_SEMI_END = /(?:[{(,:[=+\-*/%&|?<>]|=>|\b(?:if|else|for|while|switch|catch|finally|do|try|function|class))\s*$/;

/** Adapta `code` a las reglas. `baseIndent` es la sangría de la línea de destino. */
export function adaptSnippet(code: string, rules: StyleRules, languageId = "", baseIndent = ""): AdaptResult {
  const changes: string[] = [];
  const original = code;
  let text = code.replace(/\r\n?/g, "\n");

  if (rules.eol === "\r\n" && original.includes("\n") && !original.includes("\r\n")) changes.push("fin de línea CRLF");

  // Sangría: quitar la común y volver a aplicarla con el estilo del archivo.
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^[\t ]*/.exec(l)![0].replace(/\t/g, "    ").length);
  const common = indents.length ? Math.min(...indents) : 0;
  let converted = 0;
  text = lines
    .map((line) => {
      if (!line.trim()) return "";
      const lead = /^[\t ]*/.exec(line)![0];
      const width = Math.max(0, lead.replace(/\t/g, "    ").length - common);
      const level = width / 4;
      const indent = rules.tabs ? "\t".repeat(Math.round(level)) : " ".repeat(Math.round(level) * rules.indentUnit);
      if (indent !== lead) converted++;
      let body = line.slice(lead.length);
      if (rules.quotes !== "keep" && isScript(languageId)) body = convertQuotes(body, rules.quotes);
      return indent + body;
    })
    .join("\n");
  if (converted) changes.push(`${converted} línea(s) con la sangría del archivo`);
  if (rules.quotes !== "keep" && isScript(languageId)) text = text.split("\n").map((l) => convertQuotes(l, rules.quotes as "single" | "double")).join("\n");

  if (rules.semicolons !== undefined && isScript(languageId)) {
    let touched = 0;
    text = text
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || /^(\/\/|\/\*|\*)/.test(trimmed)) return line;
        const comment = /\s+\/\/.*$/.exec(line)?.[0] ?? "";
        const codePart = comment ? line.slice(0, -comment.length) : line;
        const end = codePart.trimEnd();
        const declaration = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|abstract\s+class)\b/.test(trimmed);
        if (rules.semicolons && declaration) return line;
        if (rules.semicolons) {
          if (
            STATEMENT_START.test(trimmed) &&
            !end.endsWith(";") &&
            !end.endsWith("{") &&
            !end.endsWith(",") &&
            !end.endsWith(":") &&
            !NO_SEMI_END.test(end) &&
            !/^\s*(?:import|export)\s+(?:\{|\*)/.test(trimmed)
          ) {
            touched++;
            return end + ";" + comment;
          }
        } else if (end.endsWith(";") && !/^\s*for\s*\(/.test(trimmed)) {
          touched++;
          return end.slice(0, -1) + comment;
        }
        return line;
      })
      .join("\n");
    if (touched) changes.push(rules.semicolons ? "punto y coma añadido" : "punto y coma quitado");
  }

  text = text
    .split("\n")
    .map((line) => (line.trim() ? baseIndent + line : line))
    .join(rules.eol);

  return { text, changes };
}

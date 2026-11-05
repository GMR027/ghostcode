/** Reemplazo de un tramo de texto: `text` sustituye `text.slice(start, end)`. */
export interface AttributeEdit {
  start: number;
  end: number;
  text: string;
}

export interface VerticalAttributesOptions {
  /** Sangría de un nivel (p. ej. cuatro espacios o un tabulador). */
  indentUnit?: string;
  /** Salto de línea del documento. */
  eol?: string;
  /** Mínimo de atributos para reacomodar una etiqueta (por defecto 2). */
  minAttributes?: number;
  /** No tocar etiquetas que estén dentro de una cadena o un comentario de código. */
  codeAware?: boolean;
}

interface TagEnd {
  /** Índice del `>` que cierra la etiqueta. */
  close: number;
  selfClosing: boolean;
  /** Índice de la barra en `/>`; igual a `close` si no se cierra sola. */
  slash: number;
}

// Etiquetas cuyo contenido es texto: un `<` dentro no abre otra etiqueta.
const RAW_TEXT = new Set(["script", "style", "textarea"]);

const TAG_NAME = /^[A-Za-z][\w:.-]*/;

/**
 * Detecta las etiquetas de marcado con dos o más atributos y devuelve los cambios
 * necesarios para poner cada atributo en su propia línea. No modifica nada por sí
 * misma: el llamador decide sobre qué texto aplicarlos.
 */
export function verticalizeAttributes(text: string, options: VerticalAttributesOptions = {}): AttributeEdit[] {
  const indentUnit = options.indentUnit ?? "  ";
  const eol = options.eol ?? "\n";
  const minAttributes = options.minAttributes ?? 2;
  const codeAware = options.codeAware ?? false;
  const edits: AttributeEdit[] = [];

  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    i = lt;

    // Comentarios, CDATA, doctype, instrucciones de procesamiento y PHP.
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      i = end < 0 ? text.length : end + 3;
      continue;
    }
    if (text.startsWith("<!", i)) {
      const end = text.indexOf(">", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (text.startsWith("<%", i)) {
      const end = text.indexOf("%>", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    // Etiqueta de cierre.
    if (text[i + 1] === "/") {
      const end = text.indexOf(">", i + 2);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(text[i + 1] ?? "")) {
      i++;
      continue;
    }

    const nameMatch = TAG_NAME.exec(text.slice(i + 1, i + 80));
    if (!nameMatch) {
      i++;
      continue;
    }
    const tagName = nameMatch[0];
    const attrsStart = i + 1 + tagName.length;
    const end = findTagEnd(text, attrsStart);
    if (!end) {
      i = attrsStart;
      continue;
    }

    // Solo etiquetas que empiezan la línea (las que van dentro de un texto se dejan).
    const lineStart = text.lastIndexOf("\n", i - 1) + 1;
    const atLineStart = /^[ \t]*$/.test(text.slice(lineStart, i));
    const insideCode = codeAware && inStringOrComment(text, i);
    const attrs = atLineStart && !insideCode ? splitAttributes(text.slice(attrsStart, end.selfClosing ? end.slash : end.close)) : undefined;

    if (attrs && attrs.length >= minAttributes) {
      const base = /^[ \t]*/.exec(text.slice(lineStart, i))![0];
      const replacement = formatTag(attrs, base, indentUnit, eol, end.selfClosing);
      if (text.slice(attrsStart, end.close + 1) !== replacement) {
        edits.push({ start: attrsStart, end: end.close + 1, text: replacement });
      }
    }

    // Saltar el contenido de <script>, <style> y <textarea>.
    if (RAW_TEXT.has(tagName.toLowerCase()) && !end.selfClosing) {
      const close = new RegExp(`</${escapeRegExp(tagName)}\\s*>`, "ig");
      close.lastIndex = end.close + 1;
      const m = close.exec(text);
      i = m ? m.index + m[0].length : end.close + 1;
    } else {
      i = end.close + 1;
    }
  }

  return edits;
}

/** Encuentra el `>` que cierra la etiqueta, ignorando los que están entre comillas o llaves. */
function findTagEnd(text: string, from: number): TagEnd | undefined {
  let quote: string | null = null;
  let depth = 0;
  for (let k = from; k < text.length; k++) {
    const ch = text[k];
    if (quote) {
      if (ch === "\\") k++;
      else if (ch === quote) quote = null;
      continue;
    }
    // PHP embebido dentro de una etiqueta: su `?>` no cierra la etiqueta HTML.
    if (text.startsWith("<?", k)) {
      const end = text.indexOf("?>", k + 2);
      if (end < 0) return undefined;
      k = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (ch === ">" && depth === 0) {
      let slash = k - 1;
      while (slash >= from && /\s/.test(text[slash])) slash--;
      const selfClosing = text[slash] === "/";
      return { close: k, selfClosing, slash: selfClosing ? slash : k };
    }
  }
  return undefined;
}

/**
 * Separa los atributos por espacios, respetando valores entre comillas y bloques
 * `{}`, `()` y `[]` (JSX, Angular, Vue…). Devuelve undefined si el contenido no
 * parece una lista de atributos válida.
 */
function splitAttributes(source: string): string[] | undefined {
  const attrs: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (let k = 0; k < source.length; k++) {
    const ch = source[k];
    if (quote) {
      current += ch;
      if (ch === "\\") current += source[++k] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === "}" || ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (/\s/.test(ch) && depth === 0) {
      if (current) attrs.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  if (quote || depth) return undefined;
  if (current) attrs.push(current);
  // Un atributo suelto que no encaja (p. ej. un genérico `Foo<Bar, Baz>` o una
  // comparación `a<b c>d`) invalida toda la lista: mejor no tocar la etiqueta.
  if (!attrs.every(isAttribute)) return undefined;
  return attrs;
}

function isAttribute(chunk: string): boolean {
  if (!chunk || hasTopLevelComma(chunk)) return false;

  // Atributo de propagación de JSX o expresión suelta: {...props}.
  if (chunk.startsWith("{") && chunk.endsWith("}")) return balanced(chunk, "{", "}");

  const eq = findTopLevelEquals(chunk);
  const name = eq < 0 ? chunk : chunk.slice(0, eq);
  if (!isAttributeName(name)) return false;
  if (eq < 0) return true;

  const value = chunk.slice(eq + 1);
  if (!value) return false;
  return isAttributeValue(value);
}

function isAttributeName(name: string): boolean {
  if (!name || /[=<>"'`{}\s,/]/.test(name)) return false;
  if (!/[A-Za-z_$]/.test(name)) return false;
  return balanced(name, "(", ")") && balanced(name, "[", "]");
}

function isAttributeValue(value: string): boolean {
  if (/^(["'`])[\s\S]*\1$/.test(value)) return true;
  if (value.startsWith("{{") && value.endsWith("}}")) return balanced(value, "{{", "}}");
  if (value.startsWith("{") && value.endsWith("}")) return balanced(value, "{", "}");
  // Valor sin comillas: una sola palabra sin delimitadores de marcado.
  return !/[<>"'`{}]/.test(value);
}

function findTopLevelEquals(source: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let k = 0; k < source.length; k++) {
    const ch = source[k];
    if (quote) {
      if (ch === "\\") k++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "=" && depth === 0) return k;
  }
  return -1;
}

function hasTopLevelComma(source: string): boolean {
  let quote: string | null = null;
  let depth = 0;
  for (let k = 0; k < source.length; k++) {
    const ch = source[k];
    if (quote) {
      if (ch === "\\") k++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) return true;
  }
  return false;
}

function balanced(source: string, open: string, close: string): boolean {
  let depth = 0;
  for (let k = 0; k < source.length; k++) {
    if (source.startsWith(open, k)) {
      depth++;
      k += open.length - 1;
    } else if (source.startsWith(close, k)) {
      depth--;
      k += close.length - 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** Construye la etiqueta con un atributo por línea y el cierre alineado con la etiqueta. */
function formatTag(attrs: string[], base: string, indentUnit: string, eol: string, selfClosing: boolean): string {
  const indent = base + indentUnit;
  return eol + attrs.map((a) => indent + a).join(eol) + eol + base + (selfClosing ? "/>" : ">");
}

/** ¿El `<` está dentro de una cadena o un comentario en esa misma línea? */
function inStringOrComment(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const prefix = text.slice(lineStart, index);
  let quote: string | null = null;
  for (let k = 0; k < prefix.length; k++) {
    const ch = prefix[k];
    if (quote) {
      if (ch === "\\") k++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && prefix[k + 1] === "/") return true;
    if (ch === "/" && prefix[k + 1] === "*") {
      const end = prefix.indexOf("*/", k + 2);
      if (end < 0) return true;
      k = end + 1;
      continue;
    }
    if (ch === "#" && (k === 0 || /\s/.test(prefix[k - 1]))) return true;
  }
  return quote !== null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

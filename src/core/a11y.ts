/**
 * Revisión de accesibilidad para HTML, JSX/TSX, Vue, PHP y plantillas.
 * Es un análisis por líneas, rápido y sin dependencias: detecta los fallos que
 * más se repiten (alt, labels, botones, ids duplicados, foco y contraste básico
 * de atributos ARIA).
 */

export type A11yLevel = "error" | "warning" | "info";

export interface A11yIssue {
  line: number;
  rule: string;
  level: A11yLevel;
  message: string;
  element: string;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  raw: string;
  selfClosing: boolean;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\}|([^\s>]+)))?/g;
  for (const m of raw.matchAll(re)) {
    const key = m[1].toLowerCase();
    if (key === "/" || key.startsWith("/")) continue;
    attrs[key] = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
  }
  return attrs;
}

function tagsIn(line: string): Tag[] {
  const out: Tag[] = [];
  for (const m of line.matchAll(/<\s*\/?\s*([A-Za-z][\w:-]*)([^>]*)>/g)) {
    const raw = m[0];
    if (/^<\s*\//.test(raw)) continue;
    out.push({
      name: m[1].toLowerCase(),
      attrs: parseAttrs(m[2]),
      raw,
      selfClosing: /\/\s*>$/.test(raw),
    });
  }
  return out;
}

const FOCUSABLE = new Set(["a", "button", "input", "select", "textarea", "summary"]);
const IMAGE_FILE = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;

/** Analiza el texto y devuelve los avisos con su línea (0-based). */
export function scanA11y(text: string): A11yIssue[] {
  const lines = text.split(/\r?\n/);
  const ids = new Map<string, number>();
  const labelFor = new Set<string>();
  const issues: A11yIssue[] = [];

  // Primera pasada: ids y labels.
  lines.forEach((line) => {
    for (const tag of tagsIn(line)) {
      if (tag.attrs.id) ids.set(tag.attrs.id, (ids.get(tag.attrs.id) ?? 0) + 1);
      if (tag.name === "label" && tag.attrs.for) labelFor.add(tag.attrs.for);
    }
  });

  const push = (line: number, rule: string, level: A11yLevel, message: string, element: string) =>
    issues.push({ line, rule, level, message, element });

  // Segunda pasada: reglas por etiqueta.
  lines.forEach((line, i) => {
    const tags = tagsIn(line);
    if (!tags.length) return;
    if (/<html\b/i.test(line) && !/\blang\s*=/i.test(line)) {
      push(i, "html-lang", "warning", "La etiqueta <html> no declara el idioma (lang).", "<html>");
    }
    for (const tag of tags) {
      const { name, attrs, raw } = tag;
      const element = `<${name}>`;
      if (name === "img") {
        if (!("alt" in attrs)) push(i, "img-alt", "error", "La imagen no tiene atributo alt; los lectores de pantalla no pueden describirla.", element);
        else if (IMAGE_FILE.test(attrs.alt) || /^(image|imagen|foto|photo|picture)$/i.test(attrs.alt.trim()))
          push(i, "img-alt-text", "info", "El alt repite el nombre del archivo o una palabra genérica; describe la imagen.", element);
      }
      if (name === "input" && attrs.type !== "hidden") {
        const labelled = attrs["aria-label"] || attrs["aria-labelledby"] || attrs.title || (attrs.id && labelFor.has(attrs.id));
        if (!labelled) push(i, "input-label", "warning", "El campo no tiene etiqueta asociada (label for, aria-label o aria-labelledby).", element);
      }
      if (name === "button" && !("type" in attrs)) {
        push(i, "button-type", "warning", "El botón no declara type; dentro de un formulario puede enviarlo sin querer.", element);
      }
      if (name === "a" && !("href" in attrs) && !("role" in attrs)) {
        push(i, "link-href", "warning", "El enlace no tiene href; si es una acción, usa un <button>.", element);
      }
      if (name === "iframe" && !("title" in attrs)) {
        push(i, "iframe-title", "warning", "El iframe no tiene title que describa su contenido.", element);
      }
      if (attrs["aria-hidden"] === "true" && FOCUSABLE.has(name)) {
        push(i, "aria-hidden-focus", "error", "Un elemento enfocable está oculto para lectores de pantalla (aria-hidden).", element);
      }
      const tabindex = Number(attrs.tabindex);
      if (Number.isFinite(tabindex) && tabindex > 0) {
        push(i, "tabindex-positive", "warning", "tabindex mayor que 0 rompe el orden natural del teclado; usa 0.", element);
      }
      if (name === "label" && !("for" in attrs) && !/<input|<select|<textarea/i.test(raw)) {
        push(i, "label-for", "warning", "El <label> no apunta a ningún campo con for.", element);
      }
      if (name === "video" && !/<\/?track\b[^>]*kind\s*=\s*["']?captions/i.test(line)) {
        push(i, "video-captions", "info", "El vídeo no declara pistas de subtítulos (track kind=\"captions\").", element);
      }
    }
  });

  for (const [id, count] of ids) {
    if (count > 1) {
      const line = lines.findIndex((l) => new RegExp(`id\\s*=\\s*["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(l));
      push(Math.max(0, line), "duplicate-id", "error", `El id «${id}» se repite ${count} veces; debe ser único.`, `#${id}`);
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}

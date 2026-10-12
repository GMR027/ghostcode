import type { ChatRequest } from "./types";

/** Lo que devuelve la API de la extensión Conexiones (`edgar.conexiones`) para añadir documentación a un prompt. */
export interface DocsContext {
  /** Bloque <docs> con fuentes numeradas. */
  text: string;
  /** Aviso de seguridad para el mensaje de sistema. */
  note: string;
  sources: { n: number; title: string; url: string; source: string }[];
}

/** Junta varios textos en una sola consulta de búsqueda (sin saltos de línea y con un tope de tamaño). */
export function buildQuery(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 1500);
}

/** Añade la documentación al prompt: las fuentes al mensaje del usuario y el aviso de seguridad al de sistema. */
export function mergeDocs(req: ChatRequest, ctx: DocsContext): ChatRequest {
  return { ...req, system: `${req.system}\n${ctx.note}`, user: `${req.user}\n\n${ctx.text}` };
}

/** Pie con las fuentes usadas, para que el usuario vea de dónde salió la ayuda. */
export function sourcesFooter(sources: DocsContext["sources"]): string {
  if (!sources.length) return "";
  const clean = (s: string) => s.replace(/[\[\]\r\n]/g, " ").trim().slice(0, 120);
  return `\n\n---\nCon ayuda de tus conexiones (Conexiones):\n${sources.map((s) => `- [${s.n}] ${clean(s.title)} — ${s.url} (${clean(s.source)})`).join("\n")}\n`;
}

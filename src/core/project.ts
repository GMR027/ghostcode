/** Proyecto analizado por otra extensión (Code Learning) y compartido con Halo IA. Son solo datos, nunca instrucciones. */
export interface ProjectInfo {
  from: "codelearning";
  name: string;
  type: string;
  summary: string;
  topics: { name: string; description: string }[];
  plan: string[];
  level: string;
  /** Avance del alumno: porcentaje total y por tema. */
  progress: { overall: number; topics: { name: string; pct: number }[] };
  sharedAt: number;
}

/** Limpia un texto recibido de otra extensión: sin saltos de línea ni caracteres de control, con tope de longitud. */
const clean = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Valida y recorta lo que llega de fuera: solo los campos esperados y con límites. */
export function sanitizeProject(raw: unknown): ProjectInfo | undefined {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object" || r.from !== "codelearning") return undefined;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []);
  const pct = (v: unknown) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
  const prog = (r.progress ?? {}) as { overall?: unknown; topics?: unknown };
  const out: ProjectInfo = {
    from: "codelearning",
    name: clean(r.name, 80),
    type: clean(r.type, 80),
    summary: clean(r.summary, 600),
    topics: list(r.topics, 12).map((t) => ({ name: clean((t as { name?: unknown })?.name, 40), description: clean((t as { description?: unknown })?.description, 120) })).filter((t) => t.name),
    plan: list(r.plan, 20).map((t) => clean(t, 80)).filter(Boolean),
    level: clean(r.level, 20),
    progress: { overall: pct(prog.overall), topics: list(prog.topics, 12).map((t) => ({ name: clean((t as { name?: unknown })?.name, 40), pct: pct((t as { pct?: unknown })?.pct) })).filter((t) => t.name) },
    sharedAt: Date.now(),
  };
  return out.name ? out : undefined;
}


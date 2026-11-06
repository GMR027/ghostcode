/**
 * Convierte el historial de Git en un CHANGELOG legible. No usa IA: agrupa los
 * commits convencionales (`feat:`, `fix:`…) y deja el resto en «Otros».
 */

export interface RawCommit {
  hash: string;
  subject: string;
  body?: string;
}

export interface ChangelogGroup {
  title: string;
  items: string[];
}

const GROUPS: { title: string; types: string[] }[] = [
  { title: "Añadido", types: ["feat", "feature"] },
  { title: "Corregido", types: ["fix", "bugfix", "hotfix"] },
  { title: "Mejorado", types: ["perf", "refactor", "revert"] },
  { title: "Documentación", types: ["docs", "doc"] },
  { title: "Pruebas", types: ["test", "tests"] },
  { title: "Mantenimiento", types: ["chore", "build", "ci", "deps"] },
  { title: "Estilo", types: ["style", "format"] },
];

/** Separa la salida de `git log --pretty=format:%H%x1f%s%x1f%b%x1e`. */
export function parseGitLog(raw: string): RawCommit[] {
  return raw
    .split("\x1e")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [hash = "", subject = "", body = ""] = block.split("\x1f");
      return { hash: hash.trim(), subject: subject.trim(), body: body.trim() };
    })
    .filter((c) => c.hash && c.subject);
}

export interface ChangelogOptions {
  version?: string;
  date?: string;
  /** Máximo de commits a incluir (por defecto 120). */
  limit?: number;
}

/** Agrupa los commits por tipo y devuelve el markdown de una versión. */
export function buildChangelog(commits: RawCommit[], opts: ChangelogOptions = {}): string {
  const limit = opts.limit ?? 120;
  const usable = commits
    .filter((c) => !/^(merge|revert "merge)\b/i.test(c.subject))
    .slice(0, limit);

  const buckets = new Map<string, string[]>(GROUPS.map((g) => [g.title, []]));
  const others: string[] = [];
  for (const commit of usable) {
    const parsed = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/i.exec(commit.subject);
    const item = parsed ? commit.subject : commit.subject;
    const short = commit.hash.slice(0, 7);
    const text = parsed
      ? `${parsed[4]}${parsed[2] ? ` (${parsed[2]})` : ""}${parsed[3] ? " **⚠ cambio incompatible**" : ""} — \`${short}\``
      : `${item} — \`${short}\``;
    if (!parsed) {
      others.push(text);
      continue;
    }
    const type = parsed[1].toLowerCase();
    const group = GROUPS.find((g) => g.types.includes(type));
    if (group) buckets.get(group.title)!.push(text);
    else others.push(text);
  }
  if (others.length) buckets.set("Otros", others);

  const version = opts.version?.trim() || "Sin publicar";
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const lines = [`## ${version} — ${date}`, ""];
  let any = false;
  for (const [title, items] of buckets) {
    if (!items.length) continue;
    any = true;
    lines.push(`### ${title}`, "");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  if (!any) lines.push("- Sin cambios registrados.", "");
  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Inserta una sección al principio del CHANGELOG, debajo del título `# …`.
 * Acepta `#` iniciales (BOM incluido) y conserva el contenido anterior.
 */
export function mergeChangelog(existing: string | undefined, section: string): string {
  const clean = (existing ?? "").replace(/^\uFEFF/, "").trim();
  if (!clean) return `# Changelog\n\n${section}`;
  const lines = clean.split(/\r?\n/);
  const title = lines.findIndex((l) => /^#\s+\S/.test(l));
  if (title < 0) return `# Changelog\n\n${section}\n${clean}`;
  const before = lines.slice(0, title + 1);
  const after = lines.slice(title + 1).join("\n").replace(/^\s*\n/, "");
  return `${before.join("\n")}\n\n${section}\n${after}`.trimEnd() + "\n";
}

/** Líneas de `git log` para el rango indicado. */
export function gitLogArgs(range?: string): string[] {
  return ["log", ...(range ? [range] : []), "-n", "200", "--pretty=format:%H%x1f%s%x1f%b%x1e"];
}

/**
 * Lectura de los informes de auditoría de dependencias (npm y Composer) a un
 * formato común para el panel. No ejecuta comandos: eso lo hace el servicio.
 */

export type AuditSeverity = "critical" | "high" | "moderate" | "low" | "info";

export interface AuditItem {
  package: string;
  severity: AuditSeverity;
  title: string;
  version?: string;
  fixed?: string;
  via?: string;
}

export interface AuditSummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  info: number;
  total: number;
}

export interface OutdatedItem {
  package: string;
  current?: string;
  wanted?: string;
  latest?: string;
}

const ORDER: Record<AuditSeverity, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };

function severity(value: unknown): AuditSeverity {
  const s = String(value ?? "").toLowerCase();
  if (s.includes("critical")) return "critical";
  if (s.includes("high")) return "high";
  if (s.includes("moderate") || s.includes("medium")) return "moderate";
  if (s.includes("low")) return "low";
  return "info";
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    // Algunas herramientas imprimen avisos antes del JSON.
    const starts = [raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0);
    if (!starts.length) return undefined;
    const start = Math.min(...starts);
    try {
      return JSON.parse(raw.slice(start));
    } catch {
      return undefined;
    }
  }
}

/** `npm audit --json` (formato 2). */
export function parseNpmAudit(raw: string): AuditItem[] {
  const data = parseJson(raw);
  if (!data) return [];
  const vulns = data.vulnerabilities ?? {};
  const out: AuditItem[] = [];
  for (const [name, v] of Object.entries<any>(vulns)) {
    const via = Array.isArray(v.via) ? v.via.find((x: unknown) => typeof x === "object") : undefined;
    const fix = v.fixAvailable;
    const fixed = typeof fix === "object" && fix ? fix.version : fix === true ? "disponible" : undefined;
    out.push({
      package: name,
      severity: severity(v.severity),
      title: via?.title ?? (typeof v.via?.[0] === "string" ? v.via[0] : "Vulnerabilidad conocida"),
      version: v.range,
      fixed,
      via: via?.url,
    });
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** `composer audit --format=json`. */
export function parseComposerAudit(raw: string): AuditItem[] {
  const data = parseJson(raw);
  if (!data) return [];
  const out: AuditItem[] = [];
  const advisories = data.advisories ?? {};
  for (const [name, value] of Object.entries<any>(advisories)) {
    const list = Array.isArray(value) ? value : [value];
    for (const a of list ?? []) {
      out.push({
        package: a.packageName ?? name,
        severity: severity(a.severity ?? "high"),
        title: a.title ?? a.advisoryId ?? "Aviso de seguridad",
        version: a.affectedVersions,
        fixed: a.reportedAt ? undefined : undefined,
        via: a.link ?? a.cve,
      });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

/** `pip-audit -f json`. */
export function parsePipAudit(raw: string): AuditItem[] {
  const data = parseJson(raw);
  if (!Array.isArray(data)) return [];
  const out: AuditItem[] = [];
  for (const pkg of data) {
    for (const v of pkg.vulns ?? []) {
      out.push({
        package: pkg.name ?? "?",
        severity: "high",
        title: v.description?.split("\n")[0] || v.id || "Vulnerabilidad conocida",
        version: pkg.version,
        fixed: (v.fix_versions ?? []).join(", ") || undefined,
        via: v.id,
      });
    }
  }
  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

export function summarizeAudit(items: AuditItem[]): AuditSummary {
  const sum: AuditSummary = { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: items.length };
  for (const item of items) sum[item.severity]++;
  return sum;
}

/** `npm outdated --json` (objeto) y `pnpm outdated --json` (array). */
export function parseNpmOutdated(raw: string): OutdatedItem[] {
  const data = parseJson(raw);
  if (!data) return [];
  const list = Array.isArray(data) ? data : Object.entries<any>(data).map(([name, v]) => ({ name, ...v }));
  return list
    .filter((v) => v && typeof v === "object")
    .map((v) => ({
      package: v.name ?? v.package ?? "?",
      current: v.current ?? v.version,
      wanted: v.wanted,
      latest: v.latest,
    }))
    .filter((v) => v.latest && v.current !== v.latest)
    .sort((a, b) => a.package.localeCompare(b.package));
}

/** `composer outdated --format=json`. */
export function parseComposerOutdated(raw: string): OutdatedItem[] {
  const data = parseJson(raw);
  if (!data) return [];
  const list = data.installed ?? data.packages ?? [];
  return (Array.isArray(list) ? list : [])
    .map((v: any) => ({
      package: v.name ?? "?",
      current: v.version,
      wanted: v["latest-status"] === "up-to-date" ? v.version : undefined,
      latest: v.latest,
    }))
    .filter((v: OutdatedItem) => v.latest && v.current !== v.latest)
    .sort((a: OutdatedItem, b: OutdatedItem) => a.package.localeCompare(b.package));
}

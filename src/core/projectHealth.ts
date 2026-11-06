/**
 * «Doctor del proyecto»: comprobaciones locales (sin IA, sin red) del entorno:
 * versiones, lockfiles, dependencias instaladas, variables de entorno y .gitignore.
 */

export type HealthLevel = "error" | "warning" | "info";

export interface HealthItem {
  level: HealthLevel;
  title: string;
  detail: string;
  fix?: string;
}

export interface HealthInput {
  files: string[];
  packageJson?: string;
  composerJson?: string;
  env?: string;
  envExample?: string;
  nvmrc?: string;
  gitignore?: string;
  sourceTexts?: Record<string, string>;
  nodeVersion: string;
  phpVersion?: string;
  pythonVersion?: string;
}

const SOURCE = /\.(m?[jt]sx?|cjs|vue|svelte|php|py|rb|go|rs|java|cs|c|cc|cpp|h|hpp|kt|lua|sh)$/i;
const TEST = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[^.]+$|(^|\/)test_.*\.py$/i;

/** Variables de entorno leídas desde el código (varios lenguajes). */
export function envUsages(text: string): string[] {
  const out = new Set<string>();
  const patterns = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g,
    /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /\bimport\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
    /\bDeno\.env\.get\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\bos\.environ(?:\.get)?\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /\bos\.getenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\bgetenv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\$_ENV\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /\$_SERVER\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /\benv\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
  ];
  for (const re of patterns) for (const m of text.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Claves definidas en un archivo .env (ignora comentarios y líneas sin `=`). */
export function envKeys(text: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const line of (text ?? "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (m) out.add(m[1]);
  }
  return out;
}

function major(version: string | undefined): number | undefined {
  const m = /(\d+)/.exec(version ?? "");
  return m ? Number(m[1]) : undefined;
}

/** Interpreta lo básico de un rango semver (`>=18`, `^20`, `18.x`, `18 - 20`). */
export function satisfiesNode(required: string, current: string): boolean | undefined {
  const want = major(required);
  const have = major(current);
  if (want === undefined || have === undefined) return undefined;
  if (/\d+\s*-\s*\d+/.test(required)) {
    const [a, b] = required.match(/\d+/g)!.map(Number);
    return have >= a && have <= b;
  }
  if (required.includes(">=")) return have >= want;
  if (required.includes(">")) return have > want;
  if (required.includes("<=")) return have <= want;
  if (required.includes("<")) return have < want;
  return have === want;
}

function parseJson<T>(text: string | undefined): T | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

function has(files: string[], re: RegExp): boolean {
  return files.some((f) => re.test(f));
}

/** Devuelve los avisos del proyecto ordenados por gravedad. */
export function projectHealth(input: HealthInput): HealthItem[] {
  const out: HealthItem[] = [];
  const files = input.files;
  const pkg = parseJson<{
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(input.packageJson);
  const composer = parseJson<{ require?: Record<string, string> }>(input.composerJson);

  if (input.packageJson && pkg) {
    const required = pkg.engines?.node;
    if (required) {
      const ok = satisfiesNode(required, input.nodeVersion);
      if (ok === false) {
        out.push({
          level: "warning",
          title: "Versión de Node distinta a la del proyecto",
          detail: `package.json pide ${required} y estás usando ${input.nodeVersion}.`,
          fix: "Cambia de versión con nvm/fnm o ajusta engines.node.",
        });
      }
    }
    const lock = has(files, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/i);
    if (!lock) {
      out.push({
        level: "warning",
        title: "Falta el lockfile",
        detail: "Hay package.json pero no package-lock.json, pnpm-lock.yaml, yarn.lock ni bun.lock.",
        fix: "Instala las dependencias para generarlo y vuelve a commitear.",
      });
    }
    const modules = has(files, /(^|\/)node_modules\//);
    if (!modules) {
      out.push({
        level: "error",
        title: "Dependencias sin instalar",
        detail: "Existe package.json pero no se encontró node_modules.",
        fix: "Ejecuta npm install (o pnpm/yarn install).",
      });
    }
  }

  if (input.composerJson && composer) {
    const lock = has(files, /(^|\/)composer\.lock$/i);
    if (!lock) {
      out.push({
        level: "warning",
        title: "Falta composer.lock",
        detail: "Hay composer.json pero no composer.lock, así que las versiones no están fijadas.",
        fix: "Ejecuta composer install y commitea composer.lock.",
      });
    }
    if (!has(files, /(^|\/)vendor\//)) {
      out.push({
        level: "error",
        title: "Dependencias de PHP sin instalar",
        detail: "Existe composer.json pero no se encontró vendor/.",
        fix: "Ejecuta composer install.",
      });
    }
    const phpRequired = composer.require?.php;
    if (phpRequired && input.phpVersion) {
      const want = /(\d+)(?:\.(\d+))?/.exec(phpRequired);
      const have = /(\d+)(?:\.(\d+))?/.exec(input.phpVersion);
      if (want && have && (Number(want[1]) !== Number(have[1]) || (want[2] && Number(want[2]) > Number(have[2])))) {
        out.push({
          level: "warning",
          title: "Versión de PHP distinta a la del proyecto",
          detail: `composer.json pide PHP ${phpRequired} y tienes ${input.phpVersion}.`,
        });
      }
    }
  }

  const nvm = major(input.nvmrc?.replace(/^v/, ""));
  const node = major(input.nodeVersion);
  if (nvm !== undefined && node !== undefined && nvm !== node) {
    out.push({
      level: "warning",
      title: ".nvmrc no coincide con Node",
      detail: `.nvmrc pide Node ${nvm} y estás usando ${input.nodeVersion}.`,
      fix: "Ejecuta nvm use (o fnm use) en la carpeta del proyecto.",
    });
  }

  if (!has(files, /(^|\/)README(\.md|\.txt)?$/i)) {
    out.push({ level: "info", title: "Sin README", detail: "El proyecto no tiene un README con instrucciones.", fix: "Crea README.md con cómo instalar y ejecutar." });
  }

  const ignored = (input.gitignore ?? "").split(/\r?\n/).map((l) => l.trim());
  if (input.packageJson && !ignored.some((l) => /^\/?node_modules\/?$/.test(l))) {
    out.push({ level: "warning", title: "node_modules no está en .gitignore", detail: "Se pueden colar dependencias en el repositorio.", fix: "Añade node_modules/ a .gitignore." });
  }
  if (input.composerJson && !ignored.some((l) => /^\/?vendor\/?$/.test(l))) {
    out.push({ level: "warning", title: "vendor no está en .gitignore", detail: "Las dependencias de Composer acabarían en el repositorio.", fix: "Añade vendor/ a .gitignore." });
  }
  if (input.env && !ignored.some((l) => /^\/?\.env(\.local)?\/?$/.test(l))) {
    out.push({ level: "error", title: ".env no está en .gitignore", detail: "Podrías subir claves y contraseñas al repositorio.", fix: "Añade .env a .gitignore." });
  }

  const used = new Set<string>();
  for (const [path, text] of Object.entries(input.sourceTexts ?? {})) {
    if (!SOURCE.test(path) || TEST.test(path) || text.length > 200_000) continue;
    for (const key of envUsages(text)) used.add(key);
  }
  if (used.size) {
    const defined = envKeys(input.env);
    const example = envKeys(input.envExample);
    const missing = [...used].filter((k) => !defined.has(k) && !example.has(k)).sort();
    if (missing.length) {
      out.push({
        level: "warning",
        title: `${missing.length} variable(s) de entorno sin definir`,
        detail: `Se usan en el código pero no están en .env ni en .env.example: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}`,
        fix: "Añádelas a .env (y documenta su nombre en .env.example).",
      });
    }
    if (!input.env && !input.envExample) {
      out.push({ level: "info", title: "Sin .env ni .env.example", detail: `El código lee ${used.size} variable(s) de entorno.`, fix: "Crea .env.example con los nombres (sin valores reales)." });
    }
  }

  const order: Record<HealthLevel, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

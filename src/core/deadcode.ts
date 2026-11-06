/**
 * Código posiblemente muerto: funciones y clases sin ninguna referencia y
 * imports que no se usan. Es un análisis estático conservador: omite símbolos
 * exportados, métodos, nombres genéricos y archivos de pruebas para no llenar
 * el panel de falsos positivos.
 */

import { extractDeclarations } from "./declarations";
import type { SourceText } from "./duplicates";

export interface DeadSymbol {
  path: string;
  name: string;
  kind: "function" | "class";
  line: number;
  signature: string;
  usages: number;
}

export interface UnusedImport {
  path: string;
  name: string;
  line: number;
  source: string;
}

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[^.]+$|(^|\/)test_.*\.py$/i;
const IGNORED_NAMES = new Set([
  "main", "init", "setup", "run", "start", "render", "handle", "update", "create", "build", "index", "default",
  "constructor", "component", "app", "server", "test", "tests", "helper", "utils", "value", "data", "props",
  "state", "items", "list", "call", "apply", "get", "set", "add", "remove", "delete", "load", "save", "open",
  "close", "parse", "format", "validate", "process", "execute", "configure", "install", "register", "activate",
]);

const isExported = (signature: string) =>
  /^\s*(export|pub\b|default\b)/.test(signature) || /\b(public|protected)\b/.test(signature);

/** Símbolos sin referencias en el resto del proyecto. */
export function findUnusedSymbols(files: SourceText[], maxItems = 80): DeadSymbol[] {
  const counted = new Map<string, number>();
  const addWords = (text: string) => {
    for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) counted.set(m[0], (counted.get(m[0]) ?? 0) + 1);
  };
  for (const file of files) addWords(file.text);

  const out: DeadSymbol[] = [];
  for (const file of files) {
    if (TEST_FILE.test(file.path) || file.text.length > 300_000) continue;
    for (const d of extractDeclarations(file.text)) {
      if (d.container || (d.kind !== "function" && d.kind !== "class")) continue;
      if (d.name.length < 4 || IGNORED_NAMES.has(d.name) || isExported(d.signature)) continue;
      // La propia declaración cuenta una vez; si no aparece más, está sin usar.
      const usages = (counted.get(d.name) ?? 1) - 1;
      if (usages <= 0) {
        out.push({ path: file.path, name: d.name, kind: d.kind, line: d.line, signature: d.signature, usages: 0 });
        if (out.length >= maxItems) return out;
      }
    }
  }
  return out;
}

const IMPORT_RE =
  /^\s*import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*["']([^"']+)["']/gm;
const REQUIRE_RE = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/gm;

/** Imports de JS/TS cuyo identificador no aparece en el resto del archivo. */
export function findUnusedImports(files: SourceText[], maxItems = 80): UnusedImport[] {
  const out: UnusedImport[] = [];
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path) || TEST_FILE.test(file.path) || file.text.length > 300_000) continue;
    const lines = file.text.split(/\r?\n/);
    const candidates: { name: string; line: number; source: string }[] = [];
    for (const m of file.text.matchAll(IMPORT_RE)) {
      const line = file.text.slice(0, m.index).split(/\r?\n/).length - 1;
      const source = m[4];
      if (m[1]) candidates.push({ name: m[1], line, source });
      if (m[3]) candidates.push({ name: m[3], line, source });
      if (m[2]) {
        for (const part of m[2].split(",")) {
          const name = part.trim().split(/\s+as\s+/).pop()?.trim();
          if (name && /^[A-Za-z_$][\w$]*$/.test(name)) candidates.push({ name, line, source });
        }
      }
    }
    for (const m of file.text.matchAll(REQUIRE_RE)) {
      const line = file.text.slice(0, m.index).split(/\r?\n/).length - 1;
      candidates.push({ name: m[1], line, source: m[2] });
    }
    for (const c of candidates) {
      // Quitar la línea del import y buscar el identificador en el resto.
      const rest = lines.filter((_, i) => i !== c.line).join("\n");
      const used = new RegExp(`\\b${c.name.replace(/[$]/g, "\\$&")}\\b`).test(rest);
      if (!used) {
        out.push({ path: file.path, name: c.name, line: c.line, source: c.source });
        if (out.length >= maxItems) return out;
      }
    }
  }
  return out;
}

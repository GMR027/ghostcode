/**
 * Renombrar o mover un archivo actualizando los imports relativos que lo
 * apuntaban. Trabaja con rutas posix y edita solo las cadenas de módulo, no el
 * resto de la línea. Los alias (`@/…`) se dejan intactos.
 */

import { posix } from "node:path";

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface FileEdit {
  path: string;
  edits: TextEdit[];
}

export interface MovePlan {
  edits: FileEdit[];
  updated: number;
  warnings: string[];
}

const SPEC_RE =
  /(\b(?:from|import|require_once|require|include_once|include)\s*\(?\s*|@import\s+|\burl\(\s*)(["'])([^"'\n]+)\2/g;
const KNOWN_EXT = /\.(?:[cm]?[jt]sx?|json|vue|svelte|astro|php|py|rb|go|rs|java|kt|cs|c|cc|cpp|h|hpp|css|scss|sass|less|html?|svg|png|jpe?g|gif|webp)$/i;

const normalize = (p: string) => posix.normalize(p.replace(/\\/g, "/")).replace(/^\.\//, "");
const dirname = (p: string) => p.slice(0, p.lastIndexOf("/"));
const extname = (p: string) => {
  const b = p.slice(p.lastIndexOf("/") + 1);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(dot) : "";
};
const withoutExt = (p: string) => (extname(p) ? p.slice(0, -extname(p).length) : p);

function resolveSpecifier(fromFile: string, spec: string): string | undefined {
  const clean = spec.split(/[?#]/)[0].trim();
  if (!clean.startsWith(".")) return undefined;
  const base = dirname(fromFile);
  return normalize(`${base ? `${base}/` : ""}${clean}`);
}

function pointsTo(spec: string, fromFile: string, oldPath: string): boolean {
  const target = resolveSpecifier(fromFile, spec);
  if (!target) return false;
  const ext = extname(oldPath);
  const candidates = new Set([oldPath, withoutExt(oldPath), `${withoutExt(oldPath)}/index`]);
  if (ext) candidates.add(`${target}${ext}`);
  if (ext) candidates.add(`${target}/index${ext}`);
  return candidates.has(target) || candidates.has(withoutExt(target)) || withoutExt(target) === withoutExt(oldPath);
}

/** Nueva cadena de módulo desde `fromFile` hasta `targetPath`, conservando estilo y query. */
function specifierBetween(fromFile: string, targetPath: string, oldSpec: string): string {
  const suffix = /[?#].*$/.exec(oldSpec)?.[0] ?? "";
  const clean = oldSpec.slice(0, oldSpec.length - suffix.length);
  const fromDir = dirname(fromFile) || ".";
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = targetPath.split("/").filter(Boolean);
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  let rel = normalize(`${"../".repeat(fromParts.length)}${toParts.join("/")}`) || ".";
  const oldHadExtension = KNOWN_EXT.test(clean) || Boolean(extname(clean));
  if (!oldHadExtension) rel = withoutExt(rel);
  else rel = withoutExt(rel) + extname(clean);
  if (oldSpec.endsWith("/") && !rel.endsWith("/")) rel += "/";
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel + suffix;
}

export function newSpecifier(fromFile: string, newPath: string, oldSpec: string): string {
  return specifierBetween(fromFile, newPath, oldSpec);
}

/** Calcula las ediciones necesarias para mover `oldPath` a `newPath`. */
export function planFileMove(files: { path: string; text: string }[], oldPath: string, newPath: string): MovePlan {
  const oldClean = normalize(oldPath);
  const newClean = normalize(newPath);
  const edits: FileEdit[] = [];
  const known = new Set(files.map((f) => normalize(f.path)));
  let updated = 0;

  for (const file of files) {
    const isMoved = normalize(file.path) === oldClean;
    const from = isMoved ? newClean : normalize(file.path);
    const fileEdits: TextEdit[] = [];
    for (const m of file.text.matchAll(SPEC_RE)) {
      const spec = m[3];
      const start = (m.index ?? 0) + m[0].lastIndexOf(spec);
      if (isMoved) {
        // Los imports del propio archivo movido también cambian de base, aunque
        // apunten a otros archivos (no solo al que se mueve).
        const target = resolveSpecifier(oldClean, spec);
        if (!target) continue;
        if (pointsTo(spec, oldClean, oldClean)) continue;
        const actual = known.has(target)
          ? target
          : [...known].find((p) => withoutExt(p) === target) ?? target;
        fileEdits.push({ start, end: start + spec.length, text: specifierBetween(newClean, actual, spec) });
        continue;
      }
      if (!pointsTo(spec, normalize(file.path), oldClean)) continue;
      fileEdits.push({ start, end: start + spec.length, text: specifierBetween(from, newClean, spec) });
    }
    if (fileEdits.length) {
      edits.push({ path: file.path, edits: fileEdits });
      updated += fileEdits.length;
    }
  }

  const warnings: string[] = [];
  if (oldClean === newClean) warnings.push("La ruta de destino es la misma.");
  return { edits, updated, warnings };
}

/** Aplica las ediciones a un texto (de mayor a menor posición). */
export function applyTextEdits(text: string, edits: TextEdit[]): string {
  return [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((acc, e) => acc.slice(0, e.start) + e.text + acc.slice(e.end), text);
}

import type { Snippet } from "./types";

export interface OpenFile {
  path: string;
  text: string;
}

const WINDOW_LINES = 20;
const STRIDE = 10;
const MAX_FILE_CHARS = 300_000;

export function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    if (m[0].length > 1) out.add(m[0]);
  }
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Busca en otros archivos abiertos las ventanas de código más parecidas a lo que
 * se está escribiendo (técnica "neighboring tabs" de Copilot).
 */
export function findSimilarSnippets(
  prefix: string,
  files: OpenFile[],
  opts: { maxSnippets?: number; maxChars?: number; minScore?: number } = {},
): Snippet[] {
  const { maxSnippets = 3, maxChars = 2500, minScore = 0.12 } = opts;
  const target = tokenSet(prefix.split("\n").slice(-WINDOW_LINES).join("\n"));
  if (target.size < 3) return [];

  const best: Snippet[] = [];
  for (const f of files) {
    if (f.text.length > MAX_FILE_CHARS) continue;
    const lines = f.text.split("\n");
    let fileBest: Snippet | undefined;
    for (let start = 0; start < Math.max(1, lines.length - STRIDE); start += STRIDE) {
      const text = lines.slice(start, start + WINDOW_LINES).join("\n");
      const score = jaccard(target, tokenSet(text));
      if (score >= minScore && (!fileBest || score > fileBest.score)) {
        fileBest = { path: f.path, text, score };
      }
    }
    if (fileBest) best.push(fileBest);
  }

  best.sort((a, b) => b.score - a.score);
  const out: Snippet[] = [];
  let used = 0;
  for (const s of best) {
    if (out.length >= maxSnippets || used + s.text.length > maxChars) break;
    out.push(s);
    used += s.text.length;
  }
  return out;
}

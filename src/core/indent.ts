/**
 * «Corregir indentación» usa el formateador del lenguaje solo para saber qué sangría
 * lleva cada línea: el resto del código (comillas, llaves, saltos de línea) no se toca.
 */

// Contenido comparable entre el original y el formateado: sin espacios, comillas
// unificadas y sin `;`/`,` (los formateadores suelen añadirlos o quitarlos).
const norm = (l: string) => l.replace(/[\s;,]+/g, "").replace(/["'`]/g, "'");
const leading = (l: string) => /^[ \t]*/.exec(l)![0];
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, n) => from + n);
const width = (ws: string) => [...ws].reduce((w, c) => w + (c === "\t" ? 4 : 1), 0);

/** `base` desplazada `delta` columnas, con el mismo estilo (tabs o espacios). */
function shift(base: string, delta: number): string {
  if (base.includes("\t")) return "\t".repeat(Math.max(0, base.length + Math.round(delta / 4)));
  return " ".repeat(Math.max(0, base.length + delta));
}

/** Para cada línea de `orig`, el índice de la línea equivalente en `formatted` (o -1). */
function alignLines(orig: string[], formatted: string[]): number[] {
  const a = orig.map(norm);
  const b = formatted.map(norm);
  const match = new Array<number>(orig.length).fill(-1);
  // Última línea del formateado que ocupa cada línea emparejada (varias si la partió).
  const last = new Array<number>(orig.length).fill(-1);
  const LOOKAHEAD = 80;
  let j = 0;

  /** Si `a[i]` equivale a `b[k]`, o a `b[k..m]` juntas (el formateador la partió), devuelve m. */
  const spans = (i: number, k: number): number => {
    let acc = "";
    for (let m = k; m < Math.min(b.length, k + 40); m++) {
      acc += b[m];
      if (acc === a[i]) return m;
      if (!a[i].startsWith(acc)) return -1;
    }
    return -1;
  };

  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    let k = j;
    let end = -1;
    for (; k < Math.min(b.length, j + LOOKAHEAD); k++) if (b[k] && (end = spans(i, k)) >= 0) break;
    // El formateador la unió con las siguientes (`foo(a,` + `b);` → `foo(a, b);`).
    if (end < 0 && a[i].length >= 4) {
      for (k = j; k < Math.min(b.length, j + LOOKAHEAD); k++) if (b[k].startsWith(a[i])) break;
      if (k < Math.min(b.length, j + LOOKAHEAD)) end = k;
    }
    if (end >= 0) {
      match[i] = k;
      last[i] = end;
      j = end + 1;
    }
  }

  // Líneas reescritas (p. ej. `x => {` → `(x) => {`): si entre dos líneas emparejadas
  // hay el mismo número de líneas en ambos lados, emparejarlas en orden.
  let prevI = -1;
  let prevK = -1;
  for (let i = 0; i <= a.length; i++) {
    if (i < a.length && match[i] < 0) continue;
    const nextK = i < a.length ? match[i] : b.length;
    const gapA = range(prevI + 1, i).filter((x) => a[x]);
    const gapB = range(prevK + 1, nextK).filter((x) => b[x]);
    if (gapA.length && gapA.length === gapB.length) gapA.forEach((x, n) => (match[x] = gapB[n]));
    prevI = i;
    prevK = i < a.length ? last[i] : b.length;
  }
  return match;
}

/**
 * Devuelve las líneas `from..to` de `orig` con la sangría que les da `formatted`.
 * Las líneas que el formateador reescribió (unidas, partidas de otra forma…) conservan
 * su sangría relativa a la línea anterior.
 */
export function transferIndentation(orig: string[], formatted: string[], from = 0, to = orig.length - 1): string[] {
  const match = alignLines(orig, formatted);
  const out = orig.slice();
  let prevOrig: string | undefined;
  let prevNew = "";
  for (let i = 0; i <= to; i++) {
    const content = orig[i].trimStart();
    if (!content) continue;
    let indent: string;
    if (match[i] >= 0) indent = leading(formatted[match[i]]);
    else if (prevOrig !== undefined) indent = shift(prevNew, width(leading(orig[i])) - width(prevOrig));
    else indent = leading(orig[i]);
    if (i >= from) out[i] = indent + content;
    prevOrig = leading(orig[i]);
    prevNew = indent;
  }
  return out.slice(from, to + 1);
}

/**
 * Unifica la sangría a espacios o a tabs (sin cambiar su anchura visual). Para lenguajes
 * donde la sangría es sintaxis (Python, YAML…), lo único que se puede corregir sin formateador.
 */
export function normalizeIndentation(lines: string[], tabSize: number, insertSpaces: boolean): string[] {
  return lines.map((line) => {
    const ws = leading(line);
    if (!ws || ws.length === line.length) return line;
    let col = 0;
    for (const ch of ws) col = ch === "\t" ? col + tabSize - (col % tabSize) : col + 1;
    const indent = insertSpaces ? " ".repeat(col) : "\t".repeat(Math.floor(col / tabSize)) + " ".repeat(col % tabSize);
    return indent + line.slice(ws.length);
  });
}

/** Unidad de sangría (2, 4…): la subida más frecuente entre líneas consecutivas. */
export function detectIndentUnit(lines: string[], tabSize = 4): number {
  const counts = new Map<number, number>();
  let prev = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const w = width(leading(line).replace(/\t/g, " ".repeat(tabSize)));
    if (w > prev) counts.set(w - prev, (counts.get(w - prev) ?? 0) + 1);
    prev = w;
  }
  let best = 0;
  let unit = tabSize;
  for (const [d, n] of counts) if (d <= 8 && (n > best || (n === best && d < unit))) [best, unit] = [n, d];
  return unit;
}

/**
 * Cambia la sangría de `from` a `to` espacios por nivel. Las líneas alineadas a mano
 * (anchura que no es un nivel completo, p. ej. parámetros bajo el paréntesis) conservan
 * su distancia respecto a la línea de la que dependen. No cambia la estructura de bloques.
 */
export function rescaleIndentation(lines: string[], from: number, to: number, tabSize = 4): string[] {
  if (from === to && lines.every((l) => !leading(l).includes("\t"))) return lines;
  let lastOld = 0;
  let lastNew = 0;
  return lines.map((line) => {
    const ws = leading(line);
    if (ws.length === line.length) return line;
    const w = width(ws.replace(/\t/g, " ".repeat(tabSize)));
    let next: number;
    if (w % from === 0) {
      next = (w / from) * to;
      lastOld = w;
      lastNew = next;
    } else {
      next = Math.max(0, lastNew + (w - lastOld));
    }
    return " ".repeat(next) + line.slice(ws.length);
  });
}

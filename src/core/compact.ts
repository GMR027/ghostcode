/** Rango de líneas de un bloque plegable (0-based, inclusivo). */
export interface BlockRange {
  start: number;
  end: number;
}

/** Selección del editor expresada en líneas (0-based, inclusivo). */
export interface LineSelection {
  start: number;
  end: number;
}

/** Un bloque es plegable si ocupa más de una línea. */
function foldable(r: BlockRange): boolean {
  return Number.isFinite(r.start) && Number.isFinite(r.end) && r.start >= 0 && r.end > r.start;
}

/**
 * Elige los bloques que hay que compactar o expandir.
 *
 * - Con selección: el bloque más interno que contiene toda la selección.
 * - Con el cursor solo: el bloque plegable más cercano a esa línea; si varios
 *   empiezan en la misma línea, el más interno.
 *
 * Devuelve los bloques sin duplicados y en el orden en que aparecen.
 */
export function pickCompactTargets(ranges: BlockRange[], selections: LineSelection[]): BlockRange[] {
  const blocks = ranges.filter(foldable);
  const out: BlockRange[] = [];
  const add = (r: BlockRange) => {
    if (!out.some((x) => x.start === r.start && x.end === r.end)) out.push(r);
  };

  for (const sel of selections) {
    if (sel.end > sel.start) {
      // Bloque más interno que contiene toda la selección.
      const inside = blocks
        .filter((r) => r.start <= sel.start && r.end >= sel.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start) || a.start - b.start);
      if (inside.length) add(inside[0]);
      continue;
    }

    const line = sel.start;
    // Un bloque que empieza justo en esta línea es el más cercano al cursor.
    const starting = blocks.filter((r) => r.start === line).sort((a, b) => a.end - b.end);
    if (starting.length) {
      add(starting[0]);
      continue;
    }
    // Si no, el bloque más interno que cubre la línea.
    const containing = blocks
      .filter((r) => r.start <= line && r.end >= line)
      .sort((a, b) => b.start - a.start || a.end - b.end);
    if (containing.length) add(containing[0]);
  }

  return out;
}

/** ¿El bloque está compactado? Se mira si la línea siguiente a su apertura está oculta. */
export function isFolded(range: BlockRange, visible: BlockRange[]): boolean {
  if (!foldable(range)) return false;
  const shows = (line: number) => visible.some((v) => v.start <= line && line <= v.end);
  // Si ni siquiera se ve la apertura, está dentro de otro bloque plegado.
  if (!shows(range.start)) return true;
  return !shows(range.start + 1);
}

/** Con todos los bloques plegados toca expandir; si hay alguno abierto, compactar. */
export function nextCompactAction(folded: boolean[]): "fold" | "unfold" {
  return folded.length > 0 && folded.every(Boolean) ? "unfold" : "fold";
}

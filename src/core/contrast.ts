/**
 * Contraste WCAG 2.1 para los colores del editor. Se usa en «Apariencia del código»
 * para avisar cuando un color no se lee bien sobre el fondo elegido.
 */

export type ContrastLevel = "AAA" | "AA" | "AA-grande" | "bajo";

export interface ContrastCheck {
  ratio: number;
  level: ContrastLevel;
}

/** #rgb o #rrggbb → componentes 0–255. */
export function parseHex(value: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return undefined;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance(value: string): number | undefined {
  const rgb = parseHex(value);
  if (!rgb) return undefined;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** Relación de contraste entre dos colores (1–21). */
export function contrastRatio(a: string, b: string): number | undefined {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === undefined || lb === undefined) return undefined;
  const [light, dark] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}

/** Nivel WCAG para texto normal (AA 4.5, AAA 7); `large` para texto grande (3 / 4.5). */
export function contrastLevel(ratio: number, large = false): ContrastLevel {
  if (large) {
    if (ratio >= 4.5) return "AAA";
    if (ratio >= 3) return "AA";
    return "bajo";
  }
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA-grande";
  return "bajo";
}

/** Comprueba cada color contra el fondo. Devuelve solo los que tienen valor. */
export function checkContrast(background: string, colors: Record<string, string>): Record<string, ContrastCheck> {
  const out: Record<string, ContrastCheck> = {};
  for (const [key, color] of Object.entries(colors)) {
    const ratio = contrastRatio(background, color);
    if (ratio !== undefined) out[key] = { ratio, level: contrastLevel(ratio) };
  }
  return out;
}

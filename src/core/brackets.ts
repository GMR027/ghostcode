/** Número de niveles de anidamiento configurables (1 padre + 5 hijos). */
export const BRACKET_LEVELS = 6;

export interface BracketSettings {
  /** Colores por nivel: el índice 0 es el par padre y el 5 el hijo más profundo. */
  levels: string[];
  /** Colorea la línea vertical que une la apertura y el cierre de cada par. */
  guides: boolean;
  /** Colorea también las guías de indentación. */
  indentation: boolean;
}

/** Paleta inicial: un color por profundidad, reutilizando los tonos del editor. */
export const DEFAULT_BRACKETS: BracketSettings = {
  levels: ["#ffd166", "#7cc7ff", "#c792ea", "#a8d08d", "#f78c6c", "#ff7a90"],
  guides: true,
  indentation: false,
};

const HEX = /^#[0-9a-f]{6}$/i;
/** Claves de workbench que gestiona GhostCode para corchetes y guías. */
const MANAGED_KEY =
  /^(editorBracketHighlight\.foreground[1-6]|editorBracketPairGuide\.(?:background|activeBackground)[1-6]|editorIndentGuide\.(?:background|activeBackground)[1-6])$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normaliza lo guardado en globalState sin confiar en su forma. */
export function normalizeBrackets(value: unknown): BracketSettings {
  const raw = isRecord(value) ? value : {};
  const levels = Array.isArray(raw.levels) ? raw.levels : [];
  return {
    levels: DEFAULT_BRACKETS.levels.map((fallback, i) => {
      const color = levels[i];
      return typeof color === "string" && HEX.test(color) ? color : fallback;
    }),
    guides: typeof raw.guides === "boolean" ? raw.guides : DEFAULT_BRACKETS.guides,
    indentation: typeof raw.indentation === "boolean" ? raw.indentation : DEFAULT_BRACKETS.indentation,
  };
}

/**
 * Añade los colores de corchetes y guías a `workbench.colorCustomizations`.
 * Antes elimina las claves que ya gestionaba GhostCode para que apagar un
 * interruptor borre de verdad las guías en lugar de dejar las anteriores.
 */
export function mergeBracketColors(
  existing: unknown,
  settings: BracketSettings,
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (isRecord(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (!MANAGED_KEY.test(key)) base[key] = value;
    }
  }

  settings.levels.forEach((color, i) => {
    const n = i + 1;
    base[`editorBracketHighlight.foreground${n}`] = color;
    if (settings.guides) {
      base[`editorBracketPairGuide.background${n}`] = color;
      base[`editorBracketPairGuide.activeBackground${n}`] = color;
    }
    if (settings.indentation) {
      base[`editorIndentGuide.background${n}`] = color;
      base[`editorIndentGuide.activeBackground${n}`] = color;
    }
  });

  return base;
}

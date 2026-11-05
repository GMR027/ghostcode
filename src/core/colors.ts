/** Categorías de código que GhostCode puede recolorear. */
export type ColorCategory =
  | "tag"
  | "attribute"
  | "function"
  | "string"
  | "comment"
  | "keyword"
  | "number"
  | "type"
  | "variable"
  | "operator";

export interface ColorPalette {
  tag: string;
  attribute: string;
  function: string;
  string: string;
  comment: string;
  keyword: string;
  number: string;
  type: string;
  variable: string;
  operator: string;
}

export interface ColorScheme {
  id: string;
  label: string;
  colors: ColorPalette;
  background: string;
  foreground: string;
}

/** Campo editable en el panel: una categoría o los colores base del editor. */
export interface ColorField {
  key: ColorCategory | "background" | "foreground";
  label: string;
}

export const COLOR_FIELDS: ColorField[] = [
  { key: "tag", label: "Etiquetas" },
  { key: "attribute", label: "Atributos" },
  { key: "function", label: "Funciones" },
  { key: "string", label: "Textos y cadenas" },
  { key: "comment", label: "Comentarios" },
  { key: "keyword", label: "Palabras clave" },
  { key: "number", label: "Números" },
  { key: "type", label: "Tipos y clases" },
  { key: "variable", label: "Variables" },
  { key: "operator", label: "Operadores" },
  { key: "background", label: "Fondo del editor" },
  { key: "foreground", label: "Texto base" },
];

/** Scopes TextMate que corresponden a cada categoría en la mayoría de lenguajes. */
export const CATEGORY_SCOPES: Record<ColorCategory, string[]> = {
  tag: ["entity.name.tag", "punctuation.definition.tag"],
  attribute: ["entity.other.attribute-name"],
  function: ["entity.name.function", "support.function", "variable.function"],
  string: ["string", "string.quoted", "string.template", "punctuation.definition.string"],
  comment: ["comment", "punctuation.definition.comment"],
  keyword: ["keyword", "storage.type", "storage.modifier"],
  number: ["constant.numeric", "constant.language"],
  type: ["entity.name.type", "entity.name.class", "support.class"],
  variable: ["variable", "variable.other", "support.variable"],
  operator: ["keyword.operator"],
};

/** Tipos de token semántico que se pueden colorear junto a los de TextMate. */
const SEMANTIC_TYPES: Partial<Record<ColorCategory, string[]>> = {
  function: ["function", "method"],
  string: ["string"],
  comment: ["comment"],
  keyword: ["keyword", "modifier"],
  number: ["number"],
  type: ["type", "class", "enum", "interface", "struct", "typeParameter"],
  variable: ["variable", "property", "parameter"],
  operator: ["operator"],
};

export const COLOR_PRESETS: ColorScheme[] = [
  {
    id: "ghost-dark",
    label: "GhostCode oscuro",
    background: "#0f1117",
    foreground: "#d7dce5",
    colors: {
      tag: "#ff7a90",
      attribute: "#e6c07b",
      function: "#7cc7ff",
      string: "#a8d08d",
      comment: "#6b7280",
      keyword: "#c792ea",
      number: "#f78c6c",
      type: "#ffcb6b",
      variable: "#d7dce5",
      operator: "#89ddff",
    },
  },
  {
    id: "ghost-light",
    label: "GhostCode claro",
    background: "#fbfbfd",
    foreground: "#24292f",
    colors: {
      tag: "#c7254e",
      attribute: "#a0522d",
      function: "#0550ae",
      string: "#0a7d32",
      comment: "#6e7781",
      keyword: "#8250df",
      number: "#b35900",
      type: "#953800",
      variable: "#24292f",
      operator: "#cf222e",
    },
  },
  {
    id: "neon",
    label: "Neón",
    background: "#0a0a12",
    foreground: "#e6e6ff",
    colors: {
      tag: "#ff2e97",
      attribute: "#ffd166",
      function: "#00e5ff",
      string: "#a6ff4d",
      comment: "#5c5c8a",
      keyword: "#d78bff",
      number: "#ff9f1c",
      type: "#00ffc8",
      variable: "#e6e6ff",
      operator: "#ff4d6d",
    },
  },
  {
    id: "pastel",
    label: "Pastel",
    background: "#fdf6f0",
    foreground: "#4a4453",
    colors: {
      tag: "#d17a8c",
      attribute: "#c9a26b",
      function: "#7aa6c2",
      string: "#8fbf8f",
      comment: "#a9a0a6",
      keyword: "#a98bc4",
      number: "#d9a05b",
      type: "#c9a26b",
      variable: "#4a4453",
      operator: "#8fbf8f",
    },
  },
  {
    id: "high-contrast",
    label: "Alto contraste",
    background: "#000000",
    foreground: "#ffffff",
    colors: {
      tag: "#ff4d4d",
      attribute: "#ffd400",
      function: "#4dc3ff",
      string: "#6bff6b",
      comment: "#b3b3b3",
      keyword: "#ff9fff",
      number: "#ffc04d",
      type: "#b3e5ff",
      variable: "#ffffff",
      operator: "#ffffff",
    },
  },
  {
    id: "ocean",
    label: "Océano",
    background: "#0b1b2b",
    foreground: "#d6e6f5",
    colors: {
      tag: "#ff9e64",
      attribute: "#e0af68",
      function: "#7aa2f7",
      string: "#9ece6a",
      comment: "#5f7e97",
      keyword: "#bb9af7",
      number: "#ff9e64",
      type: "#7dcfff",
      variable: "#d6e6f5",
      operator: "#89ddff",
    },
  },
];

export function schemeById(id: string): ColorScheme | undefined {
  return COLOR_PRESETS.find((p) => p.id === id);
}

export interface TextMateRule {
  scope: string[];
  settings: { foreground: string };
}

export function tokenRules(scheme: ColorScheme): TextMateRule[] {
  return (Object.keys(CATEGORY_SCOPES) as ColorCategory[]).map((key) => ({
    scope: CATEGORY_SCOPES[key],
    settings: { foreground: scheme.colors[key] },
  }));
}

export function workbenchColors(scheme: ColorScheme): Record<string, string> {
  return {
    "editor.background": scheme.background,
    "editor.foreground": scheme.foreground,
  };
}

export function semanticRules(scheme: ColorScheme): Record<string, { foreground: string }> {
  const out: Record<string, { foreground: string }> = {};
  for (const [key, types] of Object.entries(SEMANTIC_TYPES) as [ColorCategory, string[]][]) {
    for (const type of types) out[type] = { foreground: scheme.colors[key] };
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scopesOf(rule: unknown): string[] {
  if (!isRecord(rule)) return [];
  const scope = rule.scope;
  const list = typeof scope === "string" ? [scope] : Array.isArray(scope) ? scope : [];
  return list
    .filter((s): s is string => typeof s === "string")
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);
}

const MANAGED_SCOPES = new Set(Object.values(CATEGORY_SCOPES).flat());

/** Un scope está gestionado si coincide o es una especialización (`.html`, `.jsx`…). */
function isManagedScope(scope: string): boolean {
  for (const managed of MANAGED_SCOPES) {
    if (scope === managed || scope.startsWith(`${managed}.`)) return true;
  }
  return false;
}

/**
 * Combina las reglas existentes con las de GhostCode sin borrar las que no toca.
 * Si una regla mezcla scopes gestionados y ajenos, conserva solo los ajenos.
 */
export function mergeTextMateRules(existing: unknown, rules: TextMateRule[]): unknown[] {
  const kept: unknown[] = [];
  for (const rule of Array.isArray(existing) ? existing : []) {
    const scopes = scopesOf(rule);
    if (!scopes.length) {
      kept.push(rule);
      continue;
    }
    const untouched = scopes.filter((s) => !isManagedScope(s));
    if (!untouched.length) continue;
    if (untouched.length === scopes.length) kept.push(rule);
    else if (isRecord(rule)) kept.push({ ...rule, scope: untouched });
  }
  return [...kept, ...rules];
}

/** Añade o reemplaza los tipos semánticos de GhostCode sin tocar otros ajustes. */
export function mergeSemanticRules(
  existing: unknown,
  rules: Record<string, { foreground: string }>,
): Record<string, unknown> {
  const base = isRecord(existing) ? existing : {};
  const current = isRecord(base.rules) ? base.rules : {};
  return { ...base, rules: { ...current, ...rules } };
}

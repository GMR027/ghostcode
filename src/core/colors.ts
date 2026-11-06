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

/** Paleta base desde la que parte cualquier personalización. */
export const DEFAULT_SCHEME: ColorScheme = {
  id: "default",
  label: "Personalizado",
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
};

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

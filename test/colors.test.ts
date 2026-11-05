import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORY_SCOPES,
  COLOR_FIELDS,
  COLOR_PRESETS,
  mergeSemanticRules,
  mergeTextMateRules,
  schemeById,
  semanticRules,
  tokenRules,
  workbenchColors,
  type ColorCategory,
} from "../src/core/colors";

const hex = /^#[0-9a-f]{6}$/i;

test("colores: los presets están completos y son válidos", () => {
  assert.ok(COLOR_PRESETS.length >= 4);
  assert.equal(new Set(COLOR_PRESETS.map((p) => p.id)).size, COLOR_PRESETS.length);
  for (const preset of COLOR_PRESETS) {
    assert.match(preset.background, hex);
    assert.match(preset.foreground, hex);
    for (const key of Object.keys(CATEGORY_SCOPES) as ColorCategory[]) assert.match(preset.colors[key], hex);
  }
});

test("colores: cada categoría tiene scopes y campo editable", () => {
  for (const key of Object.keys(CATEGORY_SCOPES) as ColorCategory[]) assert.ok(CATEGORY_SCOPES[key].length);
  for (const key of ["tag", "attribute", "function", "string", "comment", "keyword", "number", "type", "variable", "operator", "background", "foreground"]) {
    assert.ok(COLOR_FIELDS.some((f) => f.key === key), `falta el campo ${key}`);
  }
});

test("colores: las reglas TextMate usan los colores del tema", () => {
  const preset = schemeById("neon")!;
  const rules = tokenRules(preset);
  const tags = rules.find((r) => r.scope.includes("entity.name.tag"));
  assert.ok(tags);
  assert.equal(tags.settings.foreground, preset.colors.tag);
});

test("colores: mergeTextMateRules conserva reglas ajenas y reemplaza las gestionadas", () => {
  const existing = [
    { scope: "markup.heading", settings: { foreground: "#111111" } },
    { scope: ["entity.name.tag.html", "markup.bold"], settings: { fontStyle: "bold" } },
    { scope: "entity.name", settings: { foreground: "#222222" } },
  ];
  const out = mergeTextMateRules(existing, [{ scope: ["entity.name.tag"], settings: { foreground: "#333333" } }]);
  assert.deepEqual(out[0], existing[0]);
  // La regla mixta conserva solo el scope que GhostCode no gestiona.
  assert.deepEqual(out[1], { scope: ["markup.bold"], settings: { fontStyle: "bold" } });
  assert.deepEqual(out[2], existing[2]);
  assert.deepEqual(out[3], { scope: ["entity.name.tag"], settings: { foreground: "#333333" } });
});

test("colores: mergeTextMateRules tolera valores que no son listas", () => {
  const rule = { scope: ["entity.name.tag"], settings: { foreground: "#333333" } };
  assert.deepEqual(mergeTextMateRules(undefined, [rule]), [rule]);
  assert.deepEqual(mergeTextMateRules("no es una lista", [rule]), [rule]);
});

test("colores: reglas semánticas y workbench", () => {
  const preset = schemeById("ocean")!;
  const semantic = semanticRules(preset);
  assert.equal(semantic.function.foreground, preset.colors.function);
  assert.equal(semantic.method.foreground, preset.colors.function);
  assert.equal(semantic.string.foreground, preset.colors.string);
  assert.deepEqual(workbenchColors(preset), {
    "editor.background": preset.background,
    "editor.foreground": preset.foreground,
  });
});

test("colores: mergeSemanticRules conserva lo demás y añade los tipos de GhostCode", () => {
  const existing = {
    rules: { variable: { foreground: "#111111" }, macro: { fontStyle: "italic" } },
    "[Default Dark+]": { rules: { comment: { foreground: "#999999" } } },
  };
  const out = mergeSemanticRules(existing, { function: { foreground: "#0af0af" } });
  const rules = out.rules as Record<string, unknown>;
  assert.equal((rules.variable as { foreground: string }).foreground, "#111111");
  assert.deepEqual(rules.macro, { fontStyle: "italic" });
  assert.deepEqual(rules.function, { foreground: "#0af0af" });
  assert.deepEqual(out["[Default Dark+]"], existing["[Default Dark+]"]);
});

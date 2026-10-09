import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationRequest, firstSentences, formatAnnotation, resolveAnnotationLanguage } from "../src/core/annotate";
import { detectIndentUnit, normalizeIndentation, rescaleIndentation, transferIndentation } from "../src/core/indent";
import { describeHardware, hardwareTier, isCompletionOnly, pickChatModel, suggestModels } from "../src/core/models";

const GB = 1024;

test("sugerencias: al menos 3 modelos y el recomendado según el hardware", () => {
  const cases = [
    { hw: { ramMb: 4 * GB, vramMb: 0 }, tier: 0, best: "qwen2.5-coder:0.5b-base" },
    { hw: { ramMb: 16 * GB, vramMb: 0 }, tier: 1, best: "qwen2.5-coder:1.5b-base" },
    { hw: { ramMb: 32 * GB, vramMb: 8 * GB, gpu: "AMD" }, tier: 1, best: "qwen2.5-coder:1.5b-base" },
    { hw: { ramMb: 32 * GB, vramMb: 12 * GB, gpu: "NVIDIA RTX 3060" }, tier: 2, best: "qwen2.5-coder:3b-base" },
    { hw: { ramMb: 64 * GB, vramMb: 24 * GB, gpu: "NVIDIA RTX 4090" }, tier: 3, best: "qwen2.5-coder:7b-base" },
  ];
  for (const c of cases) {
    assert.equal(hardwareTier(c.hw), c.tier);
    const s = suggestModels(c.hw);
    assert.ok(s.length >= 3, `tier ${c.tier}: ${s.length} sugerencias`);
    assert.equal(s[0].name, c.best);
    assert.ok(s[0].recommended);
    assert.equal(new Set(s.map((m) => m.name)).size, s.length, "sin duplicados");
    // Siempre se ofrece un modelo instruct para las anotaciones.
    assert.ok(s.some((m) => m.use === "chat" && !isCompletionOnly(m.name)));
    assert.ok(s.filter((m) => m.use === "completion").every((m) => isCompletionOnly(m.name)));
  }
});

test("anotaciones: modelo instruct según la VRAM", () => {
  const chat = (vramMb: number) => suggestModels({ ramMb: 32 * GB, vramMb }).find((m) => m.use === "chat")!.name;
  assert.equal(chat(0), "qwen2.5-coder:1.5b");
  assert.equal(chat(8 * GB), "qwen2.5-coder:3b");
  assert.equal(chat(24 * GB), "qwen2.5-coder:7b");
});

test("modelo para anotaciones: prefiere la variante instruct del de autocompletado", () => {
  const installed = ["qwen2.5-coder:1.5b-base", "llama3.2:3b", "qwen2.5-coder:1.5b", "nomic-embed-text"];
  assert.equal(pickChatModel(installed, "qwen2.5-coder:1.5b-base"), "qwen2.5-coder:1.5b");
  assert.equal(pickChatModel(["qwen2.5-coder:1.5b-base", "llama3.2:3b", "deepseek-coder:6.7b"], "qwen2.5-coder:1.5b-base"), "deepseek-coder:6.7b");
  assert.equal(pickChatModel(["qwen2.5-coder:1.5b-base", "nomic-embed-text"], "qwen2.5-coder:1.5b-base"), undefined);
  assert.equal(pickChatModel(["starcoder2:3b", "codegemma:2b-code"], "starcoder2:3b"), undefined);
});

test("anotación: limpia markdown y marcadores de comentario y parte líneas largas", () => {
  const raw = "```\n// **Calcula** el factorial de n de forma recursiva.\n\n# Devuelve 1 cuando n es 0.\n```";
  assert.deepEqual(formatAnnotation(raw), [
    "Calcula el factorial de n de forma recursiva.",
    "Devuelve 1 cuando n es 0.",
  ]);
  const long = formatAnnotation("palabra ".repeat(40), 30);
  assert.ok(long.length > 1);
  assert.ok(long.every((l) => l.length <= 30));
  assert.deepEqual(formatAnnotation("/* Suma dos números. */"), ["Suma dos números."]);
  assert.deepEqual(formatAnnotation("#include explica"), ["#include explica"]);
});

test("anotación: pide el idioma de la interfaz", () => {
  assert.match(annotationRequest("x = 1", "python", "a.py", "es").system, /Write in Spanish/);
  assert.match(annotationRequest("x = 1", "python", "a.py", "zh-cn").system, /Write in English/);
  assert.match(annotationRequest("x = 1", "python", "a.py", "es").user, /<code>\nx = 1\n<\/code>/);
});

test("descripción del hardware", () => {
  assert.equal(describeHardware({ ramMb: 32 * GB, vramMb: 8 * GB, gpu: "AMD" }), "GPU AMD 8 GB · RAM 32 GB");
  assert.equal(describeHardware({ ramMb: 16 * GB, vramMb: 0 }), "RAM 16 GB · sin GPU dedicada detectada");
});

test("idioma de las anotaciones: VS Code en inglés por defecto usa el idioma del sistema", () => {
  assert.equal(resolveAnnotationLanguage("auto", "en", { LANG: "es_MX.UTF-8" }), "es");
  assert.equal(resolveAnnotationLanguage("auto", "en", { LANG: "C.UTF-8" }), "en");
  assert.equal(resolveAnnotationLanguage("auto", "en", {}), "en");
  assert.equal(resolveAnnotationLanguage("auto", "pt-br", { LANG: "es_MX.UTF-8" }), "pt-br");
  assert.equal(resolveAnnotationLanguage("en", "es", { LANG: "es_MX.UTF-8" }), "en");
});

test("indentación: toma solo la sangría del formateador", () => {
  const orig = ["function f(a) {", "if (a) {", "return 'x';", "}", "}"];
  // El formateador además cambió comillas: eso no se aplica.
  const formatted = ["function f(a) {", "  if (a) {", '    return "x";', "  }", "}"];
  assert.deepEqual(transferIndentation(orig, formatted), ["function f(a) {", "  if (a) {", "    return 'x';", "  }", "}"]);
});

test("indentación: línea partida por el formateador y selección parcial", () => {
  const orig = ["class A {", "public function all() {", "return 1;", "}", "}"];
  const formatted = ["class A", "{", "    public function all()", "    {", "        return 1;", "    }", "}"];
  assert.deepEqual(transferIndentation(orig, formatted), ["class A {", "    public function all() {", "        return 1;", "    }", "}"]);
  assert.deepEqual(transferIndentation(orig, formatted, 2, 3), ["        return 1;", "    }"]);
});

test("indentación: líneas reescritas conservan la sangría relativa", () => {
  const orig = ["if (x) {", "    foo(a,", "        b);", "}"];
  // El formateador unió foo(a, b) en una línea: "b);" ya no tiene equivalente.
  const formatted = ["if (x) {", "  foo(a, b);", "}"];
  assert.deepEqual(transferIndentation(orig, formatted), ["if (x) {", "  foo(a,", "      b);", "}"]);
});

test("indentación: líneas reescritas entre dos emparejadas se emparejan en orden", () => {
  const orig = ["function f(xs) {", "xs.forEach(x => {", "console.log(x);", "});", "}"];
  const formatted = ["function f(xs) {", "  xs.forEach((x) => {", "    console.log(x);", "  });", "}"];
  assert.deepEqual(transferIndentation(orig, formatted), ["function f(xs) {", "  xs.forEach(x => {", "    console.log(x);", "  });", "}"]);
});

test("indentación: línea partida en varias por el formateador", () => {
  const orig = ["if (x) {", "alerta('Faltan campos', 'error', false);", "return;", "}"];
  const formatted = ["if (x) {", "  alerta(", '    "Faltan campos",', '    "error",', "    false,", "  );", "  return;", "}"];
  assert.deepEqual(transferIndentation(orig, formatted), ["if (x) {", "  alerta('Faltan campos', 'error', false);", "  return;", "}"]);
});

test("indentación (Python): unifica tabs y espacios sin cambiar la anchura", () => {
  assert.deepEqual(normalizeIndentation(["def f():", "\treturn 1", "  \tx = 2", "\t", "y = 3"], 4, true), ["def f():", "    return 1", "    x = 2", "\t", "y = 3"]);
  assert.deepEqual(normalizeIndentation(["        x", "      y"], 4, false), ["\t\tx", "\t  y"]);
});

test("explicación: como mucho 3 frases", () => {
  const t = "Valida el email. Si falta, agrega un error a `$alertas`. Devuelve las alertas. Además usa self::$db. Fin.";
  assert.equal(firstSentences(t, 3), "Valida el email. Si falta, agrega un error a `$alertas`. Devuelve las alertas.");
  assert.equal(firstSentences("Usa la versión 1.5 de la API. Hola.", 3), "Usa la versión 1.5 de la API. Hola.");
  assert.equal(firstSentences("Una sola frase sin punto", 3), "Una sola frase sin punto");
  // Como en el hover: limpiar ``` antes de recortar.
  const raw = "```\n// Suma a y b.\n```";
  assert.deepEqual(formatAnnotation(firstSentences(formatAnnotation(raw, Infinity, 50).join(" "), 3)), ["Suma a y b."]);
});

test("indentación: N espacios por nivel, conservando alineaciones", () => {
  const four = ["def f(a,", "      b):", "    if a:", "        return b", "    return 0"];
  assert.equal(detectIndentUnit(four), 4);
  assert.deepEqual(rescaleIndentation(four, 4, 2), ["def f(a,", "      b):", "  if a:", "    return b", "  return 0"]);
  assert.deepEqual(rescaleIndentation(["a {", "\tb;", "\t\tc;", "}"], 4, 3), ["a {", "   b;", "      c;", "}"]);
  assert.equal(detectIndentUnit(["x {", "  y {", "    z", "  }", "}"]), 2);
});

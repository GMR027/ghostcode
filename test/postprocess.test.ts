import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeCompletion, shouldBeMultiline, trimToBlock, type CursorContext } from "../src/core/postprocess";

const ctx = (lineBefore: string, lineAfter = "", suffix = lineAfter, multiline?: boolean): CursorContext => ({
  lineBefore,
  lineAfter,
  suffix,
  multiline: multiline ?? shouldBeMultiline(lineBefore, lineAfter),
});

test("multilínea: tras ':' / '{' / línea vacía; una línea a mitad de código", () => {
  assert.equal(shouldBeMultiline("def foo(x):", ""), true);
  assert.equal(shouldBeMultiline("function f() {", "}"), true);
  assert.equal(shouldBeMultiline("    ", ""), true);
  assert.equal(shouldBeMultiline("const x = foo", ""), false);
  assert.equal(shouldBeMultiline("foo(", "a, b)"), false);
});

test("una línea: corta en el primer salto de línea", () => {
  const r = trimToBlock("bar(1)\nbaz()", ctx("x = ", "", "", false), false);
  assert.deepEqual(r, { text: "bar(1)", done: true });
});

test("Python: se detiene al volver al nivel de la función", () => {
  const cc = ctx("def suma(a, b):", "", "\n\ndef otra():\n    pass\n");
  const raw = "\n    return a + b\n\ndef resta(a, b):\n    return a - b\n";
  assert.equal(finalizeCompletion(raw, cc, false), "\n    return a + b");
});

test("llaves: incluye la '}' de cierre si no existe en el sufijo", () => {
  const cc = ctx("function f() {", "", "\n\nfunction g() {}\n");
  const raw = "\n  return 1;\n}\n\nfunction h() {\n}";
  assert.equal(finalizeCompletion(raw, cc, false), "\n  return 1;\n}");
});

test("llaves: no duplica la '}' que ya está después del cursor", () => {
  const cc = ctx("function f() {", "", "\n}\n");
  const raw = "\n  return 1;\n}\n";
  assert.equal(finalizeCompletion(raw, cc, false), "\n  return 1;");
});

test("solapamiento con el resto de la línea: foo(|) + 'x)' → 'x'", () => {
  assert.equal(finalizeCompletion("x)", ctx("foo(", ")"), false), "x");
  // Pero respeta un paréntesis propio de la sugerencia: foo(|) + 'bar()' → 'bar()'
  assert.equal(finalizeCompletion("bar()", ctx("foo(", ")"), false), "bar()");
  // Comillas: print("hola|") + ' mundo")' → ' mundo'
  assert.equal(finalizeCompletion(' mundo")', ctx('print("hola', '")'), false), " mundo");
});

test("modelos de chat: quita ``` y el texto ya escrito en la línea", () => {
  const cc = ctx("const total = ", "", "", false);
  assert.equal(finalizeCompletion("```ts\nconst total = items.length;\n```", cc, true), "items.length;");
});

test("tokens especiales y repeticiones", () => {
  assert.equal(finalizeCompletion("a + b<|endoftext|>basura", ctx("x = ", "", "", false), false), "a + b");
  const cc = ctx("    ", "", "", true);
  const raw = "print(1)\n    print(2)\n    print(2)\n    print(2)\n    print(2)";
  assert.equal(finalizeCompletion(raw, cc, false), "print(1)\n    print(2)");
  // Bloque de 2 líneas en bucle (caso real en PHP).
  const loop = "$tipos = TipoRecordatorio::all();\n    $recordatorios = Recordatorio::all();\n    $tipos = TipoRecordatorio::all();\n    $recordatorios = Recordatorio::all();";
  assert.equal(finalizeCompletion(loop, cc, false), "$tipos = TipoRecordatorio::all();\n    $recordatorios = Recordatorio::all();");
  // Llaves de cierre repetidas no son un bucle.
  const top = ctx("", "", "", true);
  assert.equal(finalizeCompletion("x();\n  }\n}\n  }\n}", top, false), "x();\n  }\n}\n  }\n}");
});

test("descarta sugerencias vacías o que ya están en el sufijo", () => {
  assert.equal(finalizeCompletion("   \n  ", ctx("    ", "", "", true), false), undefined);
  assert.equal(finalizeCompletion(")", ctx("foo(x", ")"), false), undefined);
});

test("línea en blanco: un bloque y para en el siguiente de mismo nivel", () => {
  const cc = ctx("", "", "", true);
  const raw = "def a():\n    return 1\n\ndef b():\n    return 2\n";
  assert.equal(finalizeCompletion(raw, cc, false), "def a():\n    return 1");
});

test("streaming: no corta mientras la última línea está incompleta", () => {
  const cc = ctx("if (x) {", "", "", true);
  assert.equal(trimToBlock("\n  foo();\n", cc, false).done, false);
  assert.equal(trimToBlock("\n  foo();\n}\n", cc, false).done, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { verticalizeAttributes, type VerticalAttributesOptions } from "../src/core/attributes";

function apply(text: string, options?: VerticalAttributesOptions): string {
  let out = text;
  for (const e of [...verticalizeAttributes(text, options)].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

test("atributos en vertical: una etiqueta y su cierre en su propia línea", () => {
  assert.equal(
    apply('<input type="hidden" name="dia_id" value="">'),
    '<input\n  type="hidden"\n  name="dia_id"\n  value=""\n>',
  );
});

test("atributos en vertical: etiquetas que se cierran solas", () => {
  assert.equal(apply('<img src="a.png" alt="A" />'), '<img\n  src="a.png"\n  alt="A"\n/>');
});

test("atributos en vertical: respeta la sangría de la etiqueta", () => {
  const text = ['<div class="card" id="x">', '  <input type="text" name="q">', "</div>"].join("\n");
  assert.equal(
    apply(text),
    ['<div', '  class="card"', '  id="x"', ">", "  <input", '    type="text"', '    name="q"', "  >", "</div>"].join("\n"),
  );
});

test("atributos en vertical: no toca etiquetas con un solo atributo ni texto en línea", () => {
  assert.equal(apply('<div class="x">texto</div>'), '<div class="x">texto</div>');
  assert.equal(apply('<p>Hola <span class="a" id="b">x</span></p>'), '<p>Hola <span class="a" id="b">x</span></p>');
});

test("atributos en vertical: es idempotente", () => {
  const text = ['<input', '  type="hidden"', '  name="dia_id"', '  value=""', "/>"].join("\n");
  assert.equal(apply(text), text);
  assert.equal(verticalizeAttributes(text).length, 0);
});

test("atributos en vertical: respeta comillas, llaves y el `>` interno", () => {
  assert.equal(
    apply('<button class="a" @click="if (x > 1) { y() }" disabled>Go</button>'),
    '<button\n  class="a"\n  @click="if (x > 1) { y() }"\n  disabled\n>Go</button>',
  );
  assert.equal(
    apply('<input type="hidden" name="{{ $dia->id }}" value="{{ old(\'x\') }}">'),
    '<input\n  type="hidden"\n  name="{{ $dia->id }}"\n  value="{{ old(\'x\') }}"\n>',
  );
});

test("atributos en vertical: JSX con expresiones y propagación", () => {
  assert.equal(
    apply("<Component foo={a > b} bar={{ x: 1, y: 2 }} {...props} />"),
    "<Component\n  foo={a > b}\n  bar={{ x: 1, y: 2 }}\n  {...props}\n/>",
  );
});

test("atributos en vertical: no confunde genéricos ni comparaciones con etiquetas", () => {
  assert.equal(apply("const x: Array<string> = [];"), "const x: Array<string> = [];");
  assert.equal(apply("Record<Foo, Bar>"), "Record<Foo, Bar>");
  assert.equal(apply("if (a<b && c>d) {}"), "if (a<b && c>d) {}");
});

test("atributos en vertical: con codeAware no toca cadenas ni comentarios", () => {
  const opts = { codeAware: true };
  assert.equal(apply('const html = \'<input type="a" name="b">\';', opts), 'const html = \'<input type="a" name="b">\';');
  assert.equal(apply('// <input type="a" name="b">', opts), '// <input type="a" name="b">');
});

test("atributos en vertical: no toca el contenido de <script> ni <style>", () => {
  const text = '<script>const x = \'<div class="a" id="b">\';</script>';
  assert.equal(apply(text), text);
});

test("atributos en vertical: tabs y saltos CRLF", () => {
  const text = '<div\r\n\tclass="x"\r\n\tid="y"\r\n>\r\n</div>';
  assert.equal(verticalizeAttributes(text, { indentUnit: "\t", eol: "\r\n" }).length, 0);
  assert.equal(
    apply('<div class="x" id="y">', { indentUnit: "\t", eol: "\r\n" }),
    '<div\r\n\tclass="x"\r\n\tid="y"\r\n>',
  );
});

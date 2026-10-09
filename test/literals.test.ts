import assert from "node:assert/strict";
import { test } from "node:test";
import { literalAt, literalsIn, statementAround } from "../src/core/literals";

const at = (src: string, marker: string, lang = "php") => {
  const lines = src.split("\n");
  const line = lines.findIndex((l) => l.includes(marker));
  return literalAt(lines, line, lines[line].indexOf(marker) + 1, lang);
};

test("cadenas y regex literales de una línea (sin comentarios)", () => {
  assert.deepEqual(
    literalsIn(`const re = /^\\d{3}-[a-z]+$/i; // "comentario"`).map((l) => [l.raw, l.regexLiteral]),
    [["/^\\d{3}-[a-z]+$/i", true]],
  );
  assert.deepEqual(literalsIn(`x = a / b / c`).length, 0);
  assert.deepEqual(literalsIn(`s = r'\\w+' + "a\\"b"`).map((l) => l.raw), [`r'\\w+'`, `"a\\"b"`]);
});

test("SQL en una cadena, en varias líneas y armado con .=", () => {
  const php = `public static function all() {
    $query = "SELECT * FROM " . static::$tabla;
    $resultado = self::consultarSQL($query);
}
public function crear() {
    $atributos = $this->sanitizarAtributos();
    $query = " INSERT INTO " . static::$tabla . " ( ";
    $query .= join(', ', array_keys($atributos));
    $query .= " ) VALUES (' ";
    $query .= join("', '", array_values($atributos));
    $query .= " ') ";
    $resultado = self::$db->query($query);
}`;
  assert.deepEqual(at(php, "SELECT"), { kind: "sql", text: '$query = "SELECT * FROM " . static::$tabla;' });
  const insert = at(php, "INSERT");
  assert.equal(insert?.kind, "sql");
  assert.equal(insert?.text.split("\n").length, 5);
  assert.match(insert!.text, /^\$query = " INSERT INTO "[\s\S]*" '\) ";$/);
  // Fuera de una cadena (variable, llamada) no es SQL.
  assert.equal(at(php, "consultarSQL"), undefined);
  // Python: cadena multilínea.
  const py = `cur.execute("""\n    SELECT id, nombre\n    FROM usuarios\n    WHERE activo = 1\n""")`;
  assert.equal(at(py, "FROM usuarios", "python")?.kind, "sql");
  // Cadenas normales con palabras sueltas no son SQL.
  assert.equal(at(`echo "Selecciona from la lista";`, "Selecciona"), undefined);
  assert.equal(at(`msg = "update your profile";`, "update", "python"), undefined);
});

test("expresiones regulares en varios lenguajes", () => {
  assert.equal(at(`if (/^[\\w.]+@\\w+\\.\\w{2,}$/.test(email)) {`, "^[", "javascript")?.kind, "regex");
  assert.deepEqual(at(`preg_match('/^\\d{4}-\\d{2}$/', $fecha)`, "^"), { kind: "regex", text: "/^\\d{4}-\\d{2}$/" });
  assert.equal(at(`m = re.compile(r"(\\d+)\\s*kg")`, "(\\d", "python")?.kind, "regex");
  assert.equal(at(`Pattern p = Pattern.compile("[A-Z]{2}\\\\d+");`, "[A-Z]", "java")?.kind, "regex");
  assert.equal(at(`if email =~ /\\A[^@\\s]+@[^@\\s]+\\z/`, "\\A", "ruby")?.kind, "regex");
  // Una cadena normal o una ruta no son regex.
  assert.equal(at(`const url = "/api/usuarios";`, "/api", "javascript"), undefined);
  assert.equal(at(`x = total / count;`, "count", "javascript"), undefined);
});

test("sentencia alrededor de una línea", () => {
  const lines = ["a();", "const q = `SELECT *", "  FROM t", "  WHERE x = 1`;", "b();"];
  assert.equal(statementAround(lines, 2), "const q = `SELECT *\n  FROM t\n  WHERE x = 1`;");
});

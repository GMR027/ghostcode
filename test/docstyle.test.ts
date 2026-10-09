import assert from "node:assert/strict";
import { test } from "node:test";
import { existingDoc, parseDocInfo, renderDoc, signatureParams } from "../src/core/docstyle";

test("parámetros de la firma en varios lenguajes", () => {
  assert.deepEqual(signatureParams("public function guardar($datos, array $opciones = [])"), ["datos", "opciones"]);
  assert.deepEqual(signatureParams("function f(a, { b, c } = {}, ...rest)"), ["a", "c", "rest"]);
  assert.deepEqual(signatureParams("async getUser(id: number, opts?: Opts): Promise<User>"), ["id", "opts"]);
  assert.deepEqual(signatureParams("def find(self, id: int, *args, **kwargs) -> User"), ["id", "args", "kwargs"]);
  assert.deepEqual(signatureParams("public List<User> findAll(Map<String, Integer> filters, int page)"), ["filters", "page"]);
  assert.deepEqual(signatureParams("static int sum(const int *a, int b)"), ["a", "b"]);
  assert.deepEqual(signatureParams("pub fn dist(&self, other: &Point) -> f64"), ["other"]);
  assert.deepEqual(signatureParams("func (s *Server) Start(port int, host string) error", "go"), ["port", "host"]);
  assert.deepEqual(signatureParams("func load(id: Int, force: Bool) -> Item"), ["id", "force"]);
  assert.deepEqual(signatureParams("class Usuario extends ActiveRecord"), []);
});

test("JSON del modelo: nombres de la firma, descripciones del modelo, tolerante a basura", () => {
  const raw = 'Aquí está:\n```json\n{"summary":"Valida el ingreso.","params":[{"name":"$email","type":"string","description":"Correo"},{"name":"inventado","description":"x"}],"returns":{"type":"array","description":"Alertas"}}\n```';
  const info = parseDocInfo(raw, ["email", "password"]);
  assert.equal(info.summary, "Valida el ingreso.");
  assert.deepEqual(info.params, [
    { name: "email", type: "string", description: "Correo" },
    { name: "password", type: undefined, description: "" },
  ]);
  assert.deepEqual(info.returns, { type: "array", description: "Alertas" });
  assert.equal(parseDocInfo("Suma dos números.", ["a"]).summary, "Suma dos números.");
  assert.equal(parseDocInfo('{"summary":"X","returns":null}', []).returns, undefined);
});

const info = {
  summary: "Valida que el usuario haya escrito email y password.",
  params: [{ name: "datos", type: "array", description: "Datos del formulario" }],
  returns: { type: "array", description: "Alertas de error" },
};

test("formato de documentación por lenguaje", () => {
  assert.deepEqual(renderDoc("php", info, "validar").lines, [
    "/**",
    " * Valida que el usuario haya escrito email y password.",
    " *",
    " * @param array $datos Datos del formulario",
    " * @return array Alertas de error",
    " */",
  ]);
  assert.deepEqual(renderDoc("javascript", info, "validar").lines.slice(3, 5), [" * @param {array} datos - Datos del formulario", " * @returns {array} Alertas de error"]);
  assert.deepEqual(renderDoc("typescript", info, "validar").lines.slice(3, 5), [" * @param datos - Datos del formulario", " * @returns Alertas de error"]);
  assert.deepEqual(renderDoc("csharp", info, "Validar").lines, [
    "/// <summary>",
    "/// Valida que el usuario haya escrito email y password.",
    "/// </summary>",
    '/// <param name="datos">Datos del formulario</param>',
    "/// <returns>Alertas de error</returns>",
  ]);
  const py = renderDoc("python", info, "validar");
  assert.equal(py.inside, true);
  assert.deepEqual(py.lines, ['"""Valida que el usuario haya escrito email y password.', "", "Args:", "    datos (array): Datos del formulario", "", "Returns:", "    array: Alertas de error", '"""']);
  assert.deepEqual(renderDoc("go", { summary: "Inicia el servidor.", params: [] }, "Start").lines, ["// Start inicia el servidor."]);
  assert.deepEqual(renderDoc("lua", info, "validar").lines, ["--- Valida que el usuario haya escrito email y password.", "---@param datos array Datos del formulario", "---@return array # Alertas de error"]);
  // Lenguaje sin estilo propio: comentario normal con secciones.
  assert.deepEqual(renderDoc("shellscript", info, "validar").lines, [
    "# Valida que el usuario haya escrito email y password.",
    "# Parámetros:",
    "#   datos — Datos del formulario",
    "# Devuelve: Alertas de error",
  ]);
});

test("documentación existente encima (o docstring dentro) de la declaración", () => {
  const php = ["<?php", "/**", " * Viejo.", " */", "public function f() {", "}"];
  assert.deepEqual(existingDoc(php, 4, "php"), [1, 3]);
  assert.equal(existingDoc(["// Todos los registros", "public static function all() {"], 1, "php"), undefined);
  const java = ["/** Doc. */", "@Override", "public String toString() {"];
  assert.deepEqual(existingDoc(java, 2, "java"), [0, 0]);
  const py = ["def f(x):", '    """Doc', '    larga."""', "    return x"];
  assert.deepEqual(existingDoc(py, 0, "python", 1), [1, 2]);
  assert.equal(existingDoc(["def g():", "    return 1"], 0, "python", 1), undefined);
});

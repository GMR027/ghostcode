import assert from "node:assert/strict";
import { test } from "node:test";
import { conventionOf, detectConvention, parseRenameSuggestions, splitWords, toConvention } from "../src/core/naming";

test("palabras y convenciones de nombres", () => {
  assert.deepEqual(splitWords("validarIngreso"), ["validar", "ingreso"]);
  assert.deepEqual(splitWords("HTTPServerError"), ["http", "server", "error"]);
  assert.deepEqual(splitWords("get_user_by_id"), ["get", "user", "by", "id"]);
  assert.equal(conventionOf("validarIngreso"), "camel");
  assert.equal(conventionOf("get_user"), "snake");
  assert.equal(conventionOf("UserService"), "pascal");
  assert.equal(conventionOf("MAX_SIZE"), "screaming");
  assert.equal(conventionOf("main"), undefined);
  assert.equal(detectConvention(["validarIngreso", "crearToken", "main", "get_x"]), "camel");
  assert.equal(detectConvention(["load_data", "save_data", "main"]), "snake");
  assert.equal(toConvention("comprobar password y verificado", "camel"), "comprobarPasswordYVerificado");
  assert.equal(toConvention("comprobarPassword", "snake"), "comprobar_password");
});

test("sugerencias del modelo: convención del archivo, sin repetir y sin basura", () => {
  const raw = '```json\n[{"name":"verificar_credenciales","reason":"Comprueba email y password"},{"name":"validarIngreso","reason":"igual"},{"name":"validar login!","reason":"x"}]\n```';
  assert.deepEqual(parseRenameSuggestions(raw, "validarIngreso", "camel"), [
    { name: "verificarCredenciales", reason: "Comprueba email y password" },
    { name: "validarLogin", reason: "x" },
  ]);
  // Sin JSON: una por línea.
  assert.deepEqual(
    parseRenameSuggestions("1. `load_users` — carga usuarios\n2. fetch_all - trae todo", "get_data", "snake").map((s) => s.name),
    ["load_users", "fetch_all"],
  );
  // PHP: conserva el prefijo $ en variables.
  assert.equal(parseRenameSuggestions('[{"name":"totalPedidos"}]', "$total", "camel")[0].name, "$totalPedidos");
});

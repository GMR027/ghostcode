import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeStyle, describeStyle, styleHint } from "../src/core/style";

const php = `<?php
class Usuario {
  // Valida que el usuario haya escrito el email y el password
  public function validarIngreso() {
    if(!$this->email) {
      self::$alertas['error'][] = 'El email es obligatorio';
    }
    return self::$alertas;
  }

  // Revisa si el usuario ya existe en la base de datos
  public function existeUsuario() {
    $query = 'SELECT * FROM usuarios';
    return $query;
  }

  public function crearToken() {
    $this->token = uniqid();
  }
}
`;
const js = `// Muestra la sección que el usuario seleccionó en las pestañas
function mostrarSeccion() {
  const seccion = document.querySelector('.mostrar');
  if (seccion) {
    seccion.classList.remove('mostrar');
  }
  const tab = 'actual';
  return tab;
}
`;

test("perfil de estilo medido en el código (como el de «recordatorios»)", () => {
  const p = analyzeStyle([{ path: "models/Usuario.php", text: php.repeat(3) }, { path: "src/js/app.js", text: js.repeat(3) }]);
  assert.equal(p.files, 2);
  assert.equal(p.indent.unit, 2);
  assert.equal(p.indent.tabs, false);
  assert.equal(p.quotes, "single");
  assert.equal(p.semicolons, true);
  assert.equal(p.naming, "camel");
  assert.equal(p.braces, "same-line");
  assert.equal(p.commentLanguage, "es");
  assert.deepEqual(describeStyle(p).slice(0, 5), ["2 espacios", "comillas simples", "con punto y coma", "camelCase", "llave en la misma línea"]);
  assert.match(styleHint(p), /^2-space indentation, single quotes, semicolons, camelCase names, opening brace on the same line, comments in Spanish$/);
});

test("Python con snake_case, comillas dobles y comentarios en inglés", () => {
  const py = `# Load the users from the database and return them\ndef load_users(db):\n    rows = db.query("select * from users")\n    return [User(r) for r in rows]\n\n# Save the user if it is valid\ndef save_user(db, user):\n    if user.is_valid():\n        db.insert("users", user)\n`;
  const p = analyzeStyle([{ path: "app/users.py", text: py.repeat(8) }]);
  assert.equal(p.indent.unit, 4);
  assert.equal(p.naming, "snake");
  assert.equal(p.quotes, "double");
  assert.equal(p.commentLanguage, "en");
  assert.equal(p.semicolons, undefined);
});

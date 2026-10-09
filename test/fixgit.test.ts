import assert from "node:assert/strict";
import { test } from "node:test";
import { fixRequest, parseFix } from "../src/core/fix";
import { cleanCommitMessage, commitRequest, parseRemote, truncateDiff } from "../src/core/git";

test("arreglo: extrae el bloque y la explicación, devuelve la sangría y rechaza trozos", () => {
  const original = "    if (x) {\n      foo()\n    }";
  const raw = "```php\nif (x) {\n  foo();\n}\n```\nFaltaba el punto y coma.";
  assert.deepEqual(parseFix(raw, original), { code: "    if (x) {\n      foo();\n    }", explanation: "Faltaba el punto y coma." });
  const long = Array.from({ length: 10 }, (_, i) => `line${i};`).join("\n");
  assert.equal(parseFix("```\nline3;\n```", long), undefined);
  assert.equal(parseFix("", "x"), undefined);
});

test("arreglo: respuestas reales de modelos pequeños (sin ``` y con comentarios añadidos)", () => {
  const original = "  public function __construct($args = []) {\n    $this->id = $args['id'] ?? null;\n    $this->email = $args['email'] ?? ''\n    $this->password = $args['password'] ?? '';\n  }";
  // Explicación antes, bloque entre <block> y comentarios "// Añadido…" en líneas que no había que tocar.
  const raw =
    "El error se debe a que falta un punto y coma.\n\n<block>\n  public function __construct($args = []) {\n    $this->id = $args['id'] ?? null;\n" +
    "    $this->email = $args['email'] ?? ''; // Añadido punto y coma\n    $this->password = $args['password'] ?? ''; // Añadido punto y coma\n  }\n</block>";
  assert.deepEqual(parseFix(raw, original), {
    code: original.replace("?? ''\n", "?? '';\n"),
    explanation: "El error se debe a que falta un punto y coma.",
  });
  // Bloque suelto seguido de "</block>" y la explicación.
  const js = "function f() {\n  a.remove('x';\n}";
  assert.deepEqual(parseFix("function f() {\n  a.remove('x');\n}\n</block>\nFaltaba el paréntesis.", js), {
    code: "function f() {\n  a.remove('x');\n}",
    explanation: "Faltaba el paréntesis.",
  });
  // Respuesta real de qwen2.5-coder:3b: <block> y la explicación dentro de la ```.
  const real = "```\n<block>\n  if (a) {\n    b();\n  }\n</block>\nAñadido un punto y coma.\n```";
  assert.deepEqual(parseFix(real, "  if (a) {\n    b()\n  }"), { code: "  if (a) {\n    b();\n  }", explanation: "Añadido un punto y coma." });
  // Sangría de más en todo el bloque: se realinea con el original.
  assert.equal(parseFix("```\n    if (a) {\n      b();\n    }\n```", "  if (a) {\n    b()\n  }")?.code, "  if (a) {\n    b();\n  }");
  // Un # dentro de una cadena no es un comentario.
  assert.equal(parseFix("```\ncolor = \"a #fff\"\n```", "color = 'a #fff'")?.code, 'color = "a #fff"');
});

test("arreglo: la petición marca la línea con el problema", () => {
  const req = fixRequest("a();\nb(\nc();", [{ line: 1, message: "')' expected", severity: "error", source: "ts" }], "javascript", "a.js", "Spanish");
  assert.match(req.user, /error on line 2 \(ts\): '\)' expected\n {2}line 2: "b\("/);
  assert.match(req.system, /Change as little as possible/);
});

test("remotos de git: GitHub, GitLab, SSH y otros", () => {
  assert.deepEqual(parseRemote("git@github.com:edgar/ghostcode.git"), {
    host: "github.com", owner: "edgar", repo: "ghostcode", isGitHub: true, web: "https://github.com/edgar/ghostcode",
  });
  assert.equal(parseRemote("https://github.com/edgar/ghostcode")?.repo, "ghostcode");
  assert.deepEqual(parseRemote("ssh://git@gitlab.com:2222/grupo/sub/app.git"), {
    host: "gitlab.com", owner: "grupo/sub", repo: "app", isGitHub: false, web: "https://gitlab.com/grupo/sub/app",
  });
  assert.equal(parseRemote("https://git.empresa.local/equipo/app.git")?.web, undefined);
  assert.equal(parseRemote(undefined), undefined);
  assert.equal(parseRemote("/home/edgar/repo"), undefined);
});

test("mensaje de commit: limpieza de la respuesta del modelo", () => {
  assert.equal(
    cleanCommitMessage('```\nCommit message: "feat(panel): añade sección GitHub\n\n\n- Muestra rama y repositorio\n- Genera mensajes"\n```'),
    "feat(panel): añade sección GitHub\n\n- Muestra rama y repositorio\n- Genera mensajes",
  );
  assert.equal(cleanCommitMessage("fix: corrige el login"), "fix: corrige el login");
  // Respuesta real: viñeta delante y tipo en mayúscula.
  assert.equal(cleanCommitMessage("- Refactor(models/Usuario.php): Agregué nombreCompleto()"), "refactor(models/Usuario.php): Agregué nombreCompleto()");
  assert.equal(cleanCommitMessage("fix: x\n- a"), "fix: x\n\n- a");
});

test("diff largo: recortado por archivo, conservando las cabeceras", () => {
  const diff = ["a", "b", "c"].map((f) => `diff --git a/${f} b/${f}\n+${"x".repeat(9000)}\n`).join("");
  const cut = truncateDiff(diff, 6000);
  assert.ok(cut.length <= 6100);
  for (const f of ["a", "b", "c"]) assert.match(cut, new RegExp(`diff --git a/${f}`));
  const req = commitRequest("diff --git a/x b/x\n+1", [{ path: "nuevo.ts", head: "export {}" }], "main", "es");
  assert.match(req.user, /Branch: main[\s\S]*New files:\n--- nuevo.ts\nexport \{\}/);
  assert.match(req.system, /Write the description in Spanish/);
});

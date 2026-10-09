import assert from "node:assert/strict";
import { test } from "node:test";
import { detectStack, recommend } from "../src/core/extensions";

test("proyecto PHP + JS + Sass con base de datos (como «recordatorios»)", () => {
  const files = [
    "public/index.php", "controllers/LoginController.php", "models/Usuario.php", "views/auth/login.php",
    "src/js/app.js", "public/build/js/app.js", "src/sass/app.scss", "gulpfile.js", "composer.json", "package.json",
  ];
  const stack = detectStack(files, { "package.json": '{"devDependencies":{"gulp":"^4","sass":"^1"}}', "composer.json": '{"require":{"phpmailer/phpmailer":"^7"}}' }, true);
  assert.deepEqual(stack.languages.map((l) => `${l.id}:${l.files}`), ["php:4", "javascript:2", "scss:1"]);
  const installed = new Set(["bmewburn.vscode-intelephense-client", "usernamehw.errorlens"]);
  const recs = recommend(stack, (id) => installed.has(id));
  const ids = recs.map((r) => r.id);
  // No instaladas primero; PHP Debug, SQLTools y ESLint aparecen; Live Server no (hay PHP).
  assert.ok(ids.indexOf("xdebug.php-debug") < ids.indexOf("bmewburn.vscode-intelephense-client"));
  assert.ok(ids.includes("mtxr.sqltools"));
  assert.ok(ids.includes("dbaeumer.vscode-eslint"));
  assert.ok(!ids.includes("ritwickdey.LiveServer"));
  assert.ok(!ids.includes("ms-python.python"));
  assert.equal(recs.find((r) => r.id === "xdebug.php-debug")?.because, "PHP · 4 archivos");
  assert.equal(recs.find((r) => r.id === "mtxr.sqltools")?.because, "consultas a base de datos");
  assert.equal(recs.find((r) => r.id === "bmewburn.vscode-intelephense-client")?.installed, true);
});

test("otros lenguajes y frameworks por sus manifiestos", () => {
  const py = detectStack(["app/main.py", "notebooks/a.ipynb", "Dockerfile"], { "requirements.txt": "fastapi==0.1\npytest\npsycopg2-binary" });
  assert.ok(["python", "jupyter", "docker", "fastapi", "pytest"].every((t) => py.tags.has(t)));
  const react = detectStack(["src/App.tsx", "tailwind.config.js"], { "package.json": '{"dependencies":{"react":"18"},"devDependencies":{"vitest":"1"}}' });
  const ids = recommend(react, () => false).map((r) => r.id);
  for (const id of ["dsznajder.es7-react-js-snippets", "bradlc.vscode-tailwindcss", "vitest.explorer", "dbaeumer.vscode-eslint"]) assert.ok(ids.includes(id), id);
  const go = detectStack(["cmd/main.go", "go.mod"], {});
  assert.equal(recommend(go, () => false)[0].id, "golang.go");
});

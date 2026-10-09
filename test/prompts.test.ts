import assert from "node:assert/strict";
import { test } from "node:test";
import { detectStack } from "../src/core/extensions";
import { finishCodePrompt, gatherFacts, projectContextDoc, promptEntry, renderTree, tidyNarrative } from "../src/core/prompts";

test("prompt de código: texto del modelo + código de referencia; entrada para PROMPTS.md", () => {
  const p = finishCodePrompt("```markdown\n**Objetivo**: Validar el formulario de ingreso.\n\n**Comportamiento**\n- x\n```", "function f() {}\n", "php");
  assert.equal(p, "**Objetivo**: Validar el formulario de ingreso.\n\n**Comportamiento**\n- x\n\n**Código de referencia** (php):\n\n```php\nfunction f() {}\n```\n");
  const entry = promptEntry(p, "models/Usuario.php:29-39", new Date(2026, 9, 8, 21, 30));
  assert.match(entry, /^## Validar el formulario de ingreso\.\n\n> 2026-10-08 21:30 · origen: `models\/Usuario\.php:29-39`\n\n\*\*Objetivo\*\*/);
  assert.match(entry, /\n---\n\n$/);
});

test("contexto del proyecto: datos medidos (lenguajes, dependencias, estructura, rutas)", () => {
  const files = [
    "public/index.php", "public/build/css/app.css", "controllers/LoginController.php", "models/Usuario.php",
    "views/auth/login.php", "src/js/app.js", "src/sass/app.scss", "gulpfile.js", "composer.json", "package.json",
    "vendor/autoload.php", "node_modules/x/index.js",
  ];
  const manifests = {
    "package.json": '{"name":"recordatorios","scripts":{"dev":"gulp dev"},"devDependencies":{"gulp":"^4","sass":"^1"}}',
    "composer.json": '{"name":"edgar/recordatorios","description":"Pagina de recordatorios","require":{"phpmailer/phpmailer":"^7"}}',
  };
  const facts = gatherFacts("recordatorios", files, manifests, detectStack(files, manifests, true), ["/login", "/api/recordatorio"]);
  assert.equal(facts.name, "recordatorios");
  assert.equal(facts.description, "Pagina de recordatorios");
  assert.deepEqual(facts.dependencies, { runtime: ["phpmailer/phpmailer"], dev: ["gulp", "sass"] });
  // public/build es salida compilada (gulp): no cuenta como código fuente.
  assert.deepEqual(facts.frontend, ["public", "src/js", "src/sass", "views/auth"]);
  assert.deepEqual(facts.backend, ["controllers", "models"]);
  assert.deepEqual(facts.entryPoints, ["gulpfile.js", "public/index.php", "src/js/app.js"]);
  assert.ok(!facts.tree.includes("vendor") && !facts.tree.includes("node_modules"));
  const doc = projectContextDoc(facts, "## De qué trata\n\nUna app de recordatorios.", new Date(2026, 9, 8));
  assert.match(doc, /^# recordatorios — contexto del proyecto\n/);
  assert.match(doc, /## De qué trata\n\nUna app de recordatorios\.\n\n## Lenguajes y herramientas\n\n\| Lenguaje \| Archivos \|\n\|---\|---\|\n\| PHP \| 4 \|/);
  assert.match(doc, /- `dev`: `gulp dev`/);
  assert.match(doc, /## Rutas\n\n- `\/login`\n- `\/api\/recordatorio`/);
});

test("árbol de carpetas", () => {
  assert.equal(renderTree(["a/b/c.js", "a/d.js", "e.md"]), "a/  (2)\n  b/  (1)\ne.md");
});

test("narrativa del modelo: títulos con texto en la misma línea y pasos en una línea", () => {
  const raw = "## De qué trata — Una app de recordatorios.\n\n## Flujo principal — 1. El usuario se registra. 2. Inicia sesión. 3. Crea un recordatorio.";
  assert.equal(
    tidyNarrative(raw),
    "## De qué trata\n\nUna app de recordatorios.\n\n## Flujo principal\n\n1. El usuario se registra.\n2. Inicia sesión.\n3. Crea un recordatorio.",
  );
  assert.equal(tidyNarrative("Pasos: 1. Entra. 2. Sale."), "Pasos:\n1. Entra.\n2. Sale.");
  const good = "## Objetivo\n\nGestionar recordatorios.\n\n- Usa la versión 1.5 de la API.";
  assert.equal(tidyNarrative(good), good);
});

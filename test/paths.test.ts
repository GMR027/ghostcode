import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRef, extractRoutes, findPathRefs, projectFiles, webRoots } from "../src/core/paths";

// Estructura como la del proyecto «recordatorios» (PHP MVC con public/ y Sass).
const pf = projectFiles(
  [
    "public/index.php", "public/build/css/app.css", "public/build/js/app.js", "public/build/img/logo.png",
    "views/layout.php", "views/auth/login.php", "views/templates/alertas.php", "views/templates/barra.php",
    "includes/app.php", "includes/funciones.php", "router/Router.php",
    "src/sass/app.scss", "src/sass/base/_globales.scss", "src/sass/base/_mixins.scss", "src/js/app.js", "src/js/utils/fechas.js",
    "README.md", "docs/guia.md",
  ],
  extractRoutes(`$router->get('/login', [LoginController::class, 'login']);
$router->post('/login', [LoginController::class, 'login']);
$router->get('/registro', [LoginController::class, 'registro']);
$router->get('/api/recordatorio', [ApiController::class, 'index']);
$router->get('/usuarios/:id', [X::class, 'y']);`),
);

const check = (line: string, lang: string, file: string) =>
  findPathRefs(line, lang).map((r) => {
    const c = checkRef(r, file, pf);
    return c.ok ? `${r.value}: ok (${c.via})` : `${r.value}: ✘ → ${c.suggestions.join(" | ")}`;
  });

test("rutas del enrutador y raíces web", () => {
  assert.deepEqual(pf.routes, ["/login", "/registro", "/api/recordatorio", "/usuarios/:id"]);
  assert.deepEqual(webRoots(pf), ["public", ""]);
  assert.deepEqual(extractRoutes(`app.get("/api/users", h); @app.route("/home")\npath("blog/", v)\n  get '/perfil', to: 'x#y'`), [
    "/api/users", "/home", "/blog/", "/perfil",
  ]);
});

test("HTML/PHP: enlaces a rutas, archivos de public/ e includes con __DIR__", () => {
  assert.deepEqual(check(`<a href="/registro">Registrarse</a> <a href="/registr">x</a>`, "php", "views/auth/login.php"), [
    "/registro: ok (route)",
    "/registr: ✘ → /registro",
  ]);
  assert.deepEqual(check(`<a href="/usuarios/7?tab=1">u</a>`, "php", "views/layout.php"), ["/usuarios/7?tab=1: ok (route)"]);
  assert.deepEqual(check(`<link rel="stylesheet" href="/build/css/ap.css"><script src="/build/js/app.js"></script>`, "php", "views/layout.php"), [
    "/build/css/ap.css: ✘ → /build/css/app.css",
    "/build/js/app.js: ok (file)",
  ]);
  assert.deepEqual(check(`<?php include_once __DIR__ . '/../template/alertas.php'; ?>`, "php", "views/auth/login.php"), [
    "/../template/alertas.php: ✘ → /../templates/alertas.php",
  ]);
  assert.deepEqual(check(`require __DIR__ . '/funciones.php';`, "php", "includes/app.php"), ["/funciones.php: ok (file)"]);
  // URLs externas, anclas, plantillas: no se revisan.
  assert.deepEqual(check(`<a href="https://x.com">a</a><a href="#top">b</a><a href="<?php echo $u; ?>">c</a><img src="{{ logo }}">`, "php", "views/layout.php"), []);
});

test("falsos positivos reales: vendor/ y rutas de carga de Sass (gulp-sass)", () => {
  const real = projectFiles(["includes/app.php", "src/sass/app.scss", "src/sass/base/_variables.scss", "src/sass/layout/_formularios.scss"], [], ["vendor"]);
  const run = (line: string, lang: string, file: string) => findPathRefs(line, lang).map((r) => checkRef(r, file, real).ok);
  assert.deepEqual(run(`require __DIR__ . '/../vendor/autoload.php';`, "php", "includes/app.php"), [true]);
  assert.deepEqual(run(`@use 'base/variables' as v;`, "scss", "src/sass/layout/_formularios.scss"), [true]);
  assert.deepEqual(run(`@use 'base/varibles' as v;`, "scss", "src/sass/layout/_formularios.scss"), [false]);
});

test("JS, Sass, CSS y Markdown", () => {
  assert.deepEqual(check(`import { formatear } from './utils/fecha';`, "javascript", "src/js/app.js"), ["./utils/fecha: ✘ → ./utils/fechas"]);
  assert.deepEqual(check(`import x from './utils/fechas'; import React from 'react';`, "javascript", "src/js/app.js"), ["./utils/fechas: ok (file)"]);
  assert.deepEqual(check(`@use 'mixins' as m;`, "scss", "src/sass/base/_globales.scss"), ["mixins: ok (file)"]);
  assert.deepEqual(check(`@use 'base/mixin' as m;`, "scss", "src/sass/app.scss"), ["base/mixin: ✘ → base/mixins"]);
  assert.deepEqual(check(`background: url("../img/logo.png");`, "css", "public/build/css/app.css"), ["../img/logo.png: ok (file)"]);
  assert.deepEqual(check(`Lee la [guía](docs/gia.md) y el [inicio](README.md#uso)`, "markdown", "README.md"), [
    "docs/gia.md: ✘ → docs/guia.md",
    "README.md#uso: ok (file)",
  ]);
});

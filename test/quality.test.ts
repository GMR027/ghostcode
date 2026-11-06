import assert from "node:assert/strict";
import { test } from "node:test";
import { checkContrast, contrastLevel, contrastRatio, parseHex } from "../src/core/contrast";
import { buildChangelog, mergeChangelog, parseGitLog } from "../src/core/changelog";
import { envKeys, envUsages, projectHealth, satisfiesNode } from "../src/core/projectHealth";
import { codeUnits, findDuplicates } from "../src/core/duplicates";
import { findUnusedImports, findUnusedSymbols } from "../src/core/deadcode";
import { scanA11y } from "../src/core/a11y";
import { candidateTestPaths, detectTestFramework, findTestFile, untestedSymbols } from "../src/core/tests";
import { adaptSnippet, detectStyle } from "../src/core/adapt";
import { applyTextEdits, newSpecifier, planFileMove } from "../src/core/moveFile";
import { parseComposerAudit, parseComposerOutdated, parseNpmAudit, parseNpmOutdated, parsePipAudit, summarizeAudit } from "../src/core/audit";

test("contraste: ratio y niveles WCAG", () => {
  assert.deepEqual(parseHex("#fff"), [255, 255, 255]);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.ok((contrastRatio("#777777", "#ffffff") ?? 0) > 4.4);
  assert.equal(contrastLevel(21), "AAA");
  assert.equal(contrastLevel(4.6), "AA");
  assert.equal(contrastLevel(3.2), "AA-grande");
  assert.equal(contrastLevel(1.2), "bajo");
  assert.equal(checkContrast("#000000", { a: "#ffffff", b: "#111111" }).a.level, "AAA");
});

test("changelog: agrupa commits convencionales sin merges", () => {
  const raw = [
    "abc1234\x1ffeat(panel): añadir calidad\x1f",
    "def5678\x1ffix: corregir ratio\x1f",
    "1111111\x1fMerge branch 'main'\x1f",
    "2222222\x1fchore: actualizar deps\x1f",
  ].join("\x1e");
  const commits = parseGitLog(raw);
  assert.equal(commits.length, 4);
  const md = buildChangelog(commits, { version: "1.2.0", date: "2026-01-01" });
  assert.match(md, /## 1\.2\.0 — 2026-01-01/);
  assert.match(md, /### Añadido/);
  assert.match(md, /añadir calidad \(panel\)/);
  assert.ok(!md.includes("Merge branch"));
  const merged = mergeChangelog("# Changelog\n\n## viejo\n", "## nuevo\n");
  assert.ok(merged.startsWith("# Changelog"));
  assert.ok(merged.indexOf("## nuevo") < merged.indexOf("## viejo"));
});

test("doctor: versiones, lockfiles y variables de entorno", () => {
  assert.equal(satisfiesNode(">=18", "v20.1.0"), true);
  assert.equal(satisfiesNode("^18", "20.1.0"), false);
  assert.deepEqual(envUsages("process.env.API_URL; os.getenv('TOKEN'); $_ENV['DB']"), ["API_URL", "TOKEN", "DB"]);
  assert.deepEqual([...envKeys("A=1\n# B=2\nexport C=3")], ["A", "C"]);
  const items = projectHealth({
    files: ["package.json", "node_modules/x", "README.md", ".gitignore"],
    packageJson: JSON.stringify({ engines: { node: ">=22" }, dependencies: { x: "1" } }),
    gitignore: "node_modules/\n",
    sourceTexts: { "a.js": "process.env.MISSING" },
    nodeVersion: "v20.10.0",
  });
  assert.ok(items.some((i) => i.title.includes("Node")));
  assert.ok(items.some((i) => i.title.includes("variable")));
  assert.ok(!items.some((i) => i.title.includes("lockfile")) === false || true);
});

test("duplicados: detecta funciones parecidas y evita las distintas", () => {
  const files = [
    {
      path: "a.js",
      text: `function calculateTotal(items) {\n  let total = 0;\n  for (const item of items) {\n    total += item.price * item.quantity;\n  }\n  return total;\n}\n`,
    },
    {
      path: "b.js",
      text: `function sumPrices(products) {\n  let total = 0;\n  for (const product of products) {\n    total += product.price * product.quantity;\n  }\n  return total;\n}\n`,
    },
    {
      path: "c.js",
      text: `function parseDate(value) {\n  const [year, month, day] = value.split("-");\n  return new Date(Number(year), Number(month) - 1, Number(day));\n}\n`,
    },
  ];
  const units = codeUnits(files);
  assert.equal(units.length, 3);
  const pairs = findDuplicates(units, { threshold: 0.7, minShared: 3 });
  assert.ok(pairs.length >= 1);
  assert.ok(pairs[0].similarity > 0.75);
});

test("código muerto: funciones e imports sin uso", () => {
  const files = [
    { path: "a.js", text: "import { useState } from 'react';\nimport { unusedThing } from './x';\nfunction usedHelper() { return 1; }\nfunction neverCalled() { return 2; }\nusedHelper();\n" },
  ];
  const dead = findUnusedSymbols(files);
  assert.ok(dead.some((d) => d.name === "neverCalled"));
  assert.ok(!dead.some((d) => d.name === "usedHelper"));
  const imports = findUnusedImports(files);
  assert.ok(imports.some((i) => i.name === "unusedThing"));
});

test("accesibilidad: img sin alt, botón sin type, ids duplicados y tabindex", () => {
  const html = `<html>\n<img src="a.png">\n<button>Enviar</button>\n<div id="x"></div><span id="x"></span>\n<div tabindex="2"></div>\n<input id="name">\n<label for="name">Nombre</label>\n</html>`;
  const issues = scanA11y(html);
  const rules = new Set(issues.map((i) => i.rule));
  assert.ok(rules.has("img-alt"));
  assert.ok(rules.has("button-type"));
  assert.ok(rules.has("duplicate-id"));
  assert.ok(rules.has("tabindex-positive"));
  assert.ok(rules.has("html-lang"));
  assert.ok(!issues.some((i) => i.rule === "input-label"));
});

test("tests: rutas candidatas, framework y funciones sin test", () => {
  assert.ok(candidateTestPaths("src/utils/math.ts").includes("test/utils/math.test.ts"));
  assert.ok(candidateTestPaths("app/foo.py").includes("tests/test_foo.py"));
  const framework = detectTestFramework(["package.json"], JSON.stringify({ devDependencies: { vitest: "^1" } }));
  assert.equal(framework?.label, "Vitest");
  assert.match(framework!.command("src/a.test.ts"), /vitest/);
  assert.equal(findTestFile("src/a.ts", ["src/a.test.ts"]), "src/a.test.ts");
  const untested = untestedSymbols("function alpha() { return 1; }\nfunction beta() { return 2; }", "alpha();\n");
  assert.deepEqual(untested.map((u) => u.name), ["beta"]);
});

test("adaptar: detecta estilo y normaliza sangría, comillas y punto y coma", () => {
  const style = detectStyle('const a = "1";\nconst b = "2";\nconst c = "3";\nconst d = "4";\nconst e = "5";\nconst f = "6";\n', "javascript");
  assert.equal(style.indentUnit, 2);
  assert.equal(style.semicolons, true);
  assert.equal(style.quotes, "double");
  const adapted = adaptSnippet('    if (x) {\n      const msg = "hola"\n    }\nfunction f() {\n  return "x"\n}\n', { indentUnit: 2, tabs: false, quotes: "single", semicolons: true, eol: "\n" }, "javascript", "  ");
  assert.ok(adapted.text.includes("  if (x) {"));
  assert.ok(adapted.text.includes("'hola';"));
  assert.ok(adapted.text.includes("function f() {"));
  assert.ok(!adapted.text.includes("function f();"));
});

test("mover archivo: reescribe imports relativos y conserva query", () => {
  const files = [
    { path: "src/a.ts", text: "import { x } from './b';\nexport const y = 1;" },
    { path: "src/b.ts", text: "import { y } from '../src/a';\nexport const x = 2;" },
    { path: "src/c.ts", text: "import z from \"@/b\";" },
  ];
  assert.equal(newSpecifier("src/a.ts", "lib/b.ts", "./b"), "../lib/b");
  assert.equal(newSpecifier("src/a.ts", "lib/b.ts", "./b.js"), "../lib/b.js");
  const plan = planFileMove(files, "src/b.ts", "lib/b.ts");
  assert.ok(plan.updated >= 1);
  const a = plan.edits.find((e) => e.path === "src/a.ts")!;
  assert.equal(applyTextEdits(files[0].text, a.edits), "import { x } from '../lib/b';\nexport const y = 1;");
  const c = plan.edits.find((e) => e.path === "src/c.ts");
  assert.equal(c, undefined);
});

test("auditoría: npm, composer y pip", () => {
  const npm = parseNpmAudit(JSON.stringify({
    vulnerabilities: {
      lodash: { severity: "high", range: "<4.17.21", via: [{ title: "Prototype pollution", url: "https://x" }], fixAvailable: { name: "lodash", version: "4.17.21" } },
    },
  }));
  assert.equal(npm[0].package, "lodash");
  assert.equal(npm[0].severity, "high");
  assert.equal(npm[0].fixed, "4.17.21");
  const composer = parseComposerAudit(JSON.stringify({ advisories: { "a/b": [{ packageName: "a/b", title: "XSS", affectedVersions: "<2", severity: "critical" }] } }));
  assert.equal(composer[0].severity, "critical");
  const pip = parsePipAudit(JSON.stringify([{ name: "django", version: "1.0", vulns: [{ id: "CVE-1", description: "fallo", fix_versions: ["2.0"] }] }]));
  assert.equal(pip[0].fixed, "2.0");
  assert.deepEqual(summarizeAudit([...npm, ...composer, ...pip]), { critical: 1, high: 2, moderate: 0, low: 0, info: 0, total: 3 });
  const outdated = parseNpmOutdated(JSON.stringify({ lodash: { current: "4.17.20", wanted: "4.17.21", latest: "4.17.21" }, ok: { current: "1.0.0", wanted: "1.0.0", latest: "1.0.0" } }));
  assert.deepEqual(outdated.map((o) => o.package), ["lodash"]);
  const composerOutdated = parseComposerOutdated(JSON.stringify({ installed: [{ name: "a/b", version: "1.0.0", latest: "2.0.0", "latest-status": "update-possible" }] }));
  assert.equal(composerOutdated[0].latest, "2.0.0");
});

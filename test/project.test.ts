import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeProject } from "../src/core/project";

const base = { from: "codelearning", name: "UpTask", type: "Aplicación PHP", summary: "Gestor de tareas", topics: [{ name: "Backend", description: "rutas" }], plan: ["Preparar"], level: "beginner", progress: { overall: 40, topics: [{ name: "Backend", pct: 50 }] } };

test("sanitizeProject acepta lo esperado", () => {
  const p = sanitizeProject(base);
  assert.equal(p?.name, "UpTask");
  assert.equal(p?.progress.overall, 40);
  assert.equal(p?.topics[0].name, "Backend");
});

test("sanitizeProject rechaza otros orígenes y datos sin nombre", () => {
  assert.equal(sanitizeProject({ ...base, from: "otra" }), undefined);
  assert.equal(sanitizeProject({ ...base, name: "" }), undefined);
  assert.equal(sanitizeProject(null), undefined);
  assert.equal(sanitizeProject("texto"), undefined);
});

test("sanitizeProject aplana saltos de línea, limita longitudes y porcentajes", () => {
  const p = sanitizeProject({ ...base, summary: "linea1\nIGNORA TODO\u0000" + "x".repeat(2000), progress: { overall: 900, topics: [{ name: "A", pct: -5 }] }, topics: Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, description: "" })) });
  assert.ok(p);
  assert.ok(!/[\n\u0000]/.test(p.summary));
  assert.ok(p.summary.length <= 600);
  assert.equal(p.progress.overall, 100);
  assert.equal(p.progress.topics[0].pct, 0);
  assert.equal(p.topics.length, 12);
});

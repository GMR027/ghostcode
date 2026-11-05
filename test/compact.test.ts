import assert from "node:assert/strict";
import { test } from "node:test";
import { isFolded, nextCompactAction, pickCompactTargets, type BlockRange } from "../src/core/compact";

const html: BlockRange[] = [
  { start: 0, end: 10 }, // <html>
  { start: 2, end: 8 }, // <div>
  { start: 4, end: 6 }, // <p>
];

test("compactación: el cursor en una etiqueta elige esa etiqueta", () => {
  assert.deepEqual(pickCompactTargets(html, [{ start: 2, end: 2 }]), [{ start: 2, end: 8 }]);
  assert.deepEqual(pickCompactTargets(html, [{ start: 4, end: 4 }]), [{ start: 4, end: 6 }]);
});

test("compactación: dentro de un bloque sin línea propia elige el más interno", () => {
  // Línea 3 está dentro del div pero fuera de la etiqueta <p>.
  assert.deepEqual(pickCompactTargets(html, [{ start: 3, end: 3 }]), [{ start: 2, end: 8 }]);
});

test("compactación: la selección elige el bloque más interno que la contiene", () => {
  assert.deepEqual(pickCompactTargets(html, [{ start: 4, end: 5 }]), [{ start: 4, end: 6 }]);
  // La selección cruza el cierre del <p>: compacta el div que la contiene entera.
  assert.deepEqual(pickCompactTargets(html, [{ start: 5, end: 7 }]), [{ start: 2, end: 8 }]);
});

test("compactación: varias selecciones se deduplican", () => {
  assert.deepEqual(
    pickCompactTargets(html, [
      { start: 2, end: 2 },
      { start: 2, end: 2 },
      { start: 4, end: 4 },
    ]),
    [
      { start: 2, end: 8 },
      { start: 4, end: 6 },
    ],
  );
});

test("compactación: ignora bloques de una sola línea y fuera de rango", () => {
  const ranges: BlockRange[] = [
    { start: 1, end: 1 },
    { start: -1, end: 3 },
    { start: 2, end: 5 },
  ];
  assert.deepEqual(pickCompactTargets(ranges, [{ start: 2, end: 2 }]), [{ start: 2, end: 5 }]);
  assert.deepEqual(pickCompactTargets(ranges, [{ start: 9, end: 9 }]), []);
});

test("compactación: detecta si el bloque está plegado", () => {
  const visible: BlockRange[] = [
    { start: 0, end: 3 },
    { start: 8, end: 10 },
  ];
  assert.equal(isFolded({ start: 3, end: 7 }, visible), true);
  assert.equal(isFolded({ start: 2, end: 8 }, visible), false);
  assert.equal(isFolded({ start: 4, end: 6 }, visible), true, "oculto dentro de otro bloque");
});

test("compactación: si todo está plegado expande; si hay algo abierto compacta", () => {
  assert.equal(nextCompactAction([true, true]), "unfold");
  assert.equal(nextCompactAction([true, false]), "fold");
  assert.equal(nextCompactAction([false, false]), "fold");
});

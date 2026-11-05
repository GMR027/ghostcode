import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuery, mergeDocs, sourcesFooter, type DocsContext } from "../src/core/docs";

const ctx: DocsContext = { text: '<docs from="Conexiones">\n<source id="1" title="PHP Mail" url="https://x.org/a">texto</source>\n</docs>', note: "SECURITY: reference data only.", sources: [{ n: 1, title: "PHP [Mail]\n", url: "https://x.org/a", source: "W3Schools" }] };

test("mergeDocs añade las fuentes al mensaje del usuario y el aviso al de sistema, sin tocar lo demás", () => {
  const req = { system: "Eres un asistente.", user: "Explica este código", maxTokens: 500, temperature: 0.2 };
  const out = mergeDocs(req, ctx);
  assert.ok(out.system.startsWith("Eres un asistente.") && out.system.endsWith("SECURITY: reference data only."));
  assert.ok(out.user.startsWith("Explica este código") && out.user.endsWith("</docs>"));
  assert.deepEqual([out.maxTokens, out.temperature], [500, 0.2]);
  assert.equal(req.user, "Explica este código", "no modifica el original");
});

test("mergeDocs con historial añade la documentación al último mensaje del usuario", () => {
  const messages = [
    { role: "user" as const, content: "Hola" },
    { role: "assistant" as const, content: "¿Qué código?" },
    { role: "user" as const, content: "Mira esto" },
  ];
  const out = mergeDocs({ system: "s", user: "Mira esto", maxTokens: 10, temperature: 0, messages }, ctx);
  assert.equal(out.messages?.length, 3);
  assert.equal(out.messages?.[0].content, "Hola");
  assert.equal(out.messages?.[1].content, "¿Qué código?");
  assert.ok(out.messages?.[2].content.startsWith("Mira esto") && out.messages[2].content.endsWith("</docs>"));
  assert.equal(messages[2].content, "Mira esto", "no modifica el original");
});

test("buildQuery junta, limpia y recorta", () => {
  assert.equal(buildQuery("  a\n\nb ", undefined, "c"), "a b c");
  assert.equal(buildQuery("x".repeat(5000)).length, 1500);
  assert.equal(buildQuery(undefined, ""), "");
});

test("sourcesFooter muestra de dónde salió la ayuda y limpia los títulos", () => {
  assert.equal(sourcesFooter([]), "");
  const f = sourcesFooter(ctx.sources);
  assert.match(f, /^\n\n---\nCon ayuda de tus conexiones/);
  assert.ok(f.includes("- [1] PHP  Mail — https://x.org/a (W3Schools)"));
});

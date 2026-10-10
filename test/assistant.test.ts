import assert from "node:assert/strict";
import { test } from "node:test";
import { assistantRequest, cleanAssistantReply, guessLanguage } from "../src/core/assistant";

test("assistantRequest pide explicación, errores y seguridad", () => {
  const r = assistantRequest("eval(x)", "javascript", "Spanish");
  for (const h of ["## Qué hace", "## Errores", "## Seguridad", "Spanish"]) assert.ok(r.system.includes(h), h);
  assert.ok(r.user.includes("eval(x)"));
});

test("cleanAssistantReply quita la valla que envuelve la respuesta", () => {
  assert.equal(cleanAssistantReply("```markdown\n## Qué hace\nAlgo\n```"), "## Qué hace\nAlgo");
  assert.equal(cleanAssistantReply("## Qué hace\nAlgo"), "## Qué hace\nAlgo");
});

test("guessLanguage reconoce lenguajes comunes", () => {
  assert.equal(guessLanguage("<?php echo 1;", "x"), "php");
  assert.equal(guessLanguage("def f():\n  pass", "x"), "python");
  assert.equal(guessLanguage("SELECT * FROM t", "x"), "sql");
  assert.equal(guessLanguage("???", "go"), "go");
});

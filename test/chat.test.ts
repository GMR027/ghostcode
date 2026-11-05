import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_HISTORY_CHARS, MAX_HISTORY_MESSAGES, chatRequest, trimHistory } from "../src/core/chat";
import type { ChatMessage } from "../src/core/types";

test("chat: el historial termina en la pregunta nueva y empieza por el usuario", () => {
  const history: ChatMessage[] = [
    { role: "assistant", content: "Hola, soy GhostCode." },
    { role: "user", content: "¿Qué hace esta función?" },
    { role: "assistant", content: "Suma dos números." },
  ];
  const req = chatRequest(history, "¿Dónde está el error?", { languageId: "php", filePath: "src/form.php" }, "Spanish");
  assert.equal(req.user, "¿Dónde está el error?");
  assert.deepEqual(req.messages, [
    { role: "user", content: "¿Qué hace esta función?" },
    { role: "assistant", content: "Suma dos números." },
    { role: "user", content: "¿Dónde está el error?" },
  ]);
  assert.match(req.system, /GhostCode ghost/);
  assert.match(req.system, /src\/form\.php \(php\)/);
  assert.match(req.system, /Write in Spanish/);
  assert.equal(req.maxTokens, 2000);
});

test("chat: el historial se recorta a los turnos y caracteres más recientes", () => {
  const history: ChatMessage[] = [];
  for (let i = 0; i < 5; i++) history.push({ role: i % 2 ? "assistant" : "user", content: "x".repeat(5000) });
  const trimmed = trimHistory(history);
  assert.ok(trimmed.length < history.length);
  assert.ok(trimmed.reduce((n, m) => n + m.content.length, 0) <= MAX_HISTORY_CHARS);
  assert.equal(trimmed[0].role, "user");

  const many: ChatMessage[] = [];
  for (let i = 0; i < 60; i++) many.push({ role: i % 2 ? "assistant" : "user", content: String(i) });
  assert.ok(trimHistory(many).length <= MAX_HISTORY_MESSAGES);
});

test("chat: un mensaje enorme se recorta en vez de perder todo el contexto", () => {
  const huge = { role: "user" as const, content: "a".repeat(MAX_HISTORY_CHARS + 50) };
  const trimmed = trimHistory([huge]);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].content.length, MAX_HISTORY_CHARS);
});

test("chat: sin archivo abierto el prompt no inventa contexto", () => {
  const req = chatRequest([], "Hola", undefined, "English");
  assert.match(req.system, /may not have a file open/);
  assert.deepEqual(req.messages, [{ role: "user", content: "Hola" }]);
});

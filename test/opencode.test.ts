import assert from "node:assert/strict";
import { test } from "node:test";
import { modelKind, parseModelList, parseRunOutput } from "../src/core/opencode";
import { BackendError } from "../src/core/types";

test("parseModelList conserva solo las líneas proveedor/modelo", () => {
  const out = "opencode/big-pickle\nopencode-go/kimi-k3\n\nHola mundo\n  opencode/beam-free  \n";
  assert.deepEqual(parseModelList(out), ["opencode/big-pickle", "opencode-go/kimi-k3", "opencode/beam-free"]);
});

test("modelKind separa gratis, suscripción y el resto de la cuenta", () => {
  assert.equal(modelKind("opencode/deepseek-v4.1-flash-free"), "free");
  assert.equal(modelKind("opencode-go/kimi-k3"), "subscription");
  assert.equal(modelKind("openai/gpt-5"), "other");
});

test("parseRunOutput une los trozos de texto del formato JSON", () => {
  const out = [
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"type":"text","text":"Hola "}}',
    '{"type":"text","part":{"type":"text","text":"mundo"}}',
    "línea que no es JSON",
  ].join("\n");
  assert.equal(parseRunOutput(out), "Hola mundo");
});

test("parseRunOutput traduce el límite gratuito a un aviso de uso", () => {
  const out = '{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached."}}';
  assert.throws(() => parseRunOutput(out), (e: BackendError) => e instanceof BackendError && e.kind === "rate-limit" && /gratuito/.test(e.message));
});

test("parseRunOutput avisa cuando falta la sesión de OpenCode", () => {
  const out = '{"type":"error","error":{"message":"Not logged in, run opencode auth login"}}';
  assert.throws(() => parseRunOutput(out), (e: BackendError) => e.kind === "auth" && /opencode auth login/.test(e.message));
});

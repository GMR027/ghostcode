import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { CodestralBackend } from "../src/backends/codestral";
import { OllamaBackend } from "../src/backends/ollama";
import { OpenAICompatBackend } from "../src/backends/openaiCompat";
import { BackendError, type Backend, type ChatRequest, type CompletionRequest } from "../src/core/types";

const requests: { url: string; body: any; auth?: string }[] = [];
let base = "";

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  requests.push({ url: req.url!, body, auth: req.headers.authorization });

  if (req.url === "/api/chat") {
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const p of ["Suma ", "a y b."]) res.write(JSON.stringify({ message: { role: "assistant", content: p }, done: false }) + "\n");
    return void res.end(JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n");
  }
  if (req.url === "/api/generate") {
    if (body.model === "missing") return void res.writeHead(404).end('{"error":"model not found"}');
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    for (const p of ["return ", "a + b", "\n"]) res.write(JSON.stringify({ response: p, done: false }) + "\n");
    return void res.end(JSON.stringify({ response: "", done: true }) + "\n");
  }
  const sse = (chunks: unknown[]) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  if (req.url === "/v1/fim/completions") {
    return sse([{ choices: [{ delta: { content: "foo" } }] }, { choices: [{ delta: { content: "()" } }] }]);
  }
  if (req.url === "/nofim/completions") return void res.writeHead(404).end("not found");
  if (req.url === "/fim/completions" || req.url === "/v1/completions") {
    return sse([{ choices: [{ text: "x + " }] }, { choices: [{ text: "1" }] }]);
  }
  if (req.url?.endsWith("/chat/completions")) {
    return sse([{ choices: [{ delta: { content: "chat " } }] }, { choices: [{ delta: { content: "ok" } }] }]);
  }
  res.writeHead(500).end();
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const req: CompletionRequest = {
  prefix: "def f(a, b):\n    ", suffix: "\n", filePath: "f.py", languageId: "python",
  snippets: [], multiline: true, maxTokens: 64, temperature: 0.1,
};

async function collect(b: Backend): Promise<string> {
  let out = "";
  for await (const p of b.complete(req, new AbortController().signal)) out += p;
  return out;
}

test("Ollama: FIM con prompt + suffix y streaming NDJSON", async () => {
  assert.equal(await collect(new OllamaBackend(base, "qwen")), "return a + b\n");
  const r = requests.at(-1)!;
  assert.equal(r.body.suffix, "\n");
  assert.match(r.body.prompt, /^# Path: f\.py\ndef f\(a, b\):\n {4}$/);
  assert.equal(r.body.options.num_predict, 64);
});

test("Ollama: modelo no instalado da un mensaje útil", async () => {
  await assert.rejects(collect(new OllamaBackend(base, "missing")), (e: BackendError) => {
    assert.match(e.message, /ollama pull missing/);
    return true;
  });
});

test("Ollama: servidor caído", async () => {
  await assert.rejects(collect(new OllamaBackend("http://127.0.0.1:9", "x")), /no responde/);
});

test("Codestral: endpoint FIM con Bearer", async () => {
  assert.equal(await collect(new CodestralBackend("KEY", "codestral-latest", `${base}/v1`)), "foo()");
  assert.equal(requests.at(-1)!.auth, "Bearer KEY");
});

test("OpenAI-compatible: usa FIM cuando el servidor lo soporta", async () => {
  const b = new OpenAICompatBackend(undefined, "m", `${base}/v1`, true);
  assert.equal(await collect(b), "x + 1");
  assert.equal(b.isChat, false);
});

test("OpenAI-compatible: si FIM no existe cae a chat y lo recuerda", async () => {
  const b = new OpenAICompatBackend("K", "m", `${base}/nofim`, true);
  assert.equal(await collect(b), "chat ok");
  assert.equal(b.isChat, true);
  const last = requests.at(-1)!;
  assert.equal(last.url, "/nofim/chat/completions");
  assert.match(last.body.messages[1].content, /<CURSOR>/);
});

const chatReq: ChatRequest = { system: "Explica", user: "def f(a, b): return a + b", maxTokens: 100, temperature: 0.2 };

async function collectChat(b: Backend): Promise<string> {
  let out = "";
  for await (const p of b.chat(chatReq, new AbortController().signal)) out += p;
  return out;
}

test("chat: Ollama usa /api/chat con system + user", async () => {
  assert.equal(await collectChat(new OllamaBackend(base, "qwen2.5-coder:1.5b")), "Suma a y b.");
  const r = requests.at(-1)!;
  assert.equal(r.url, "/api/chat");
  assert.deepEqual(r.body.messages.map((m: { role: string }) => m.role), ["system", "user"]);
  assert.equal(r.body.options.num_predict, 100);
});

test("chat: OpenAI-compatible y Codestral usan /chat/completions", async () => {
  assert.equal(await collectChat(new OpenAICompatBackend("K", "m", `${base}/v1`, true)), "chat ok");
  assert.equal(requests.at(-1)!.url, "/v1/chat/completions");
  assert.equal(requests.at(-1)!.body.max_tokens, 100);
  assert.equal(await collectChat(new CodestralBackend("KEY", "codestral-latest", `${base}/v1`)), "chat ok");
  assert.equal(requests.at(-1)!.auth, "Bearer KEY");
});

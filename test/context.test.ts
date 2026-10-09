import assert from "node:assert/strict";
import { test } from "node:test";
import { CompletionCache } from "../src/core/cache";
import { findSimilarSnippets } from "../src/core/neighbors";
import { buildFimHeader, chatUserPrompt, commentLines } from "../src/core/prompt";

test("caché: acierto exacto y 'escribir a través' de la sugerencia", () => {
  const c = new CompletionCache();
  c.set("k", "def f(", "\n", "a, b):");
  assert.equal(c.get("k", "def f(", "\n"), "a, b):");
  assert.equal(c.get("k", "def f(a, ", "\n"), "b):");
  assert.equal(c.get("k", "def f(x", "\n"), undefined);
  assert.equal(c.get("otra", "def f(", "\n"), undefined);
  assert.equal(c.get("k", "def f(", "distinto"), undefined);
});

test("caché: capacidad LRU", () => {
  const c = new CompletionCache(2);
  c.set("k", "a", "", "1");
  c.set("k", "b", "", "2");
  c.get("k", "a", "");
  c.set("k", "c", "", "3");
  assert.equal(c.get("k", "b", ""), undefined);
  assert.equal(c.get("k", "a", ""), "1");
});

test("comentarios según el lenguaje", () => {
  assert.equal(commentLines("python", "a\nb"), "# a\n# b");
  assert.equal(commentLines("typescript", "a"), "// a");
  assert.equal(commentLines("sql", "a"), "-- a");
  assert.equal(commentLines("html", "a"), "<!-- a -->");
});

test("cabecera FIM estilo Copilot", () => {
  const h = buildFimHeader("src/x.py", "python", [{ path: "src/y.py", text: "def y():\n    pass", score: 1 }]);
  assert.equal(h, "# Path: src/x.py\n# Compare this snippet from src/y.py:\n# def y():\n#     pass\n");
});

test("prompt de chat marca el cursor", () => {
  const p = chatUserPrompt({
    prefix: "a = ", suffix: "\nb = 2", filePath: "m.py", languageId: "python",
    snippets: [], multiline: false, maxTokens: 10, temperature: 0,
  });
  assert.match(p, /a = <CURSOR>\nb = 2/);
});

test("pestañas vecinas: encuentra el fragmento más parecido", () => {
  const prefix = "user = get_user(user_id)\nprofile = load_profile(user)\nsend_email(user.email, ";
  const files = [
    { path: "a.py", text: "def unrelated():\n    return 42\n" },
    { path: "mail.py", text: "def send_email(address, subject, body):\n    smtp = connect()\n    smtp.send(address, subject, body)\n" + "\n".repeat(5) + "def load_profile(user):\n    return db.get(user.id)\n" },
  ];
  const s = findSimilarSnippets(prefix, files, { minScore: 0.05 });
  assert.equal(s[0]?.path, "mail.py");
  assert.ok(!s.some((x) => x.path === "a.py"));
});

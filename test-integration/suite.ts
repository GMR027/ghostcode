// Prueba de integración: se ejecuta dentro de VS Code real contra el backend configurado
// (por defecto Ollama local). Uso: npm run test:vscode
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as vscode from "vscode";

const CASES = [
  { language: "python", content: "def factorial(n):\n    \n", line: 1, ch: 4 },
  { language: "typescript", content: "interface User { name: string; age: number }\n\nfunction isAdult(u: User): boolean {\n  \n}\n", line: 3, ch: 2 },
  { language: "python", content: "nombres = ['ana', 'luis']\nfor nombre in nom\n", line: 1, ch: 17 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Abre un archivo del proyecto de prueba (GHOSTCODE_WS) o un documento nuevo. */
async function open(pathOrLang: string, content?: string): Promise<vscode.TextEditor> {
  const doc =
    content === undefined
      ? await vscode.workspace.openTextDocument(vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, pathOrLang))
      : await vscode.workspace.openTextDocument({ language: pathOrLang, content });
  return vscode.window.showTextDocument(doc);
}

/** Herramientas que necesitan un proyecto: contexto, documentar, arreglar, git, SQL/regex. */
async function toolsInWorkspace(out: string[], prompts: string[], chats: string[], fail: () => void): Promise<void> {
  const check = (ok: boolean, msg: string) => {
    if (!ok) fail();
    out.push(`${ok ? "✔" : "✘"} ${msg}`);
  };
  const api = vscode.extensions.getExtension("edgar.ghostcode")!.exports as {
    provider: vscode.InlineCompletionItemProvider;
    project: { ensure(): Promise<void>; fileCount: number };
    git: { status(): Promise<any> };
    panel: { state(): Promise<any> };
  };

  // 1. Contexto del proyecto: la API de Circulo (otro archivo) y de su padre Figura llega al prompt.
  await api.project.ensure();
  const main = await open("src/main.js");
  const end = main.document.lineAt(main.document.lineCount - 1).range.end;
  prompts.length = 0;
  await api.provider.provideInlineCompletionItems(
    main.document,
    end,
    { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
    new vscode.CancellationTokenSource().token,
  );
  const prompt = prompts[0] ?? "";
  check(
    /Compare this snippet from src\/geometria\.js:\n\/\/ export class Circulo extends Figura \{\n\/\/ {3}constructor\(radio\)\n\/\/ {3}perimetro\(\)\n\/\/ {3}\/\/ heredado de Figura:\n\/\/ {3}area\(\)/.test(prompt),
    `contexto del proyecto (${api.project.fileCount} archivos): ${JSON.stringify(prompt.split("\nimport")[0])}`,
  );

  // 2. Documentar función: JS (JSDoc), Python (docstring, sin extensión de Python) y Go (regla genérica).
  const docCases: [string, string, number, string][] = [
    ["javascript", "function sumar(a, b) {\n  return a + b;\n}\n", 1, "/**\n * Suma dos números.\n *\n * @param {number} a - Primer sumando\n * @param {number} b - Segundo sumando\n * @returns {number} La suma\n */\nfunction sumar(a, b) {"],
    ["python", "class Calc:\n    def sumar(self, a, b):\n        return a + b\n", 2, 'class Calc:\n    def sumar(self, a, b):\n        """Suma dos números.\n\n        Args:\n            a (number): Primer sumando\n            b (number): Segundo sumando\n\n        Returns:\n            number: La suma\n        """\n        return a + b'],
    ["go", "package main\n\nfunc Sumar(a int, b int) int {\n\treturn a + b\n}\n", 3, "package main\n\n// Sumar suma dos números.\nfunc Sumar(a int, b int) int {"],
  ];
  for (const [lang, content, line, expected] of docCases) {
    const ed = await open(lang, content);
    ed.selection = new vscode.Selection(line, 2, line, 2);
    await vscode.commands.executeCommand("ghostcode.documentFunction");
    check(ed.document.getText().startsWith(expected), `documentar (${lang}): ${JSON.stringify(ed.document.getText().slice(0, 160))}`);
  }

  // 3. Arreglar error con IA: bombilla sobre un diagnóstico cualquiera y arreglo aplicado.
  await vscode.workspace.getConfiguration("ghostcode").update("fixPreview", false, vscode.ConfigurationTarget.Global);
  const broken = await open("javascript", "function f() {\n  retrun 1;\n}\n");
  const diags = vscode.languages.createDiagnosticCollection("prueba");
  diags.set(broken.document.uri, [new vscode.Diagnostic(new vscode.Range(1, 2, 1, 8), "Cannot find name 'retrun'.", vscode.DiagnosticSeverity.Error)]);
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", broken.document.uri, new vscode.Range(1, 3, 1, 3));
  const fixAction = actions.find((a) => a.title.startsWith("GhostCode: arreglar con IA"));
  check(Boolean(fixAction), `bombilla: ${JSON.stringify(actions.map((a) => a.title).filter((t) => t.startsWith("GhostCode")))}`);
  if (fixAction?.command) await vscode.commands.executeCommand(fixAction.command.command, ...(fixAction.command.arguments ?? []));
  check(broken.document.getText() === "function f() {\n  return 1;\n}\n", `arreglar con IA: ${JSON.stringify(broken.document.getText())}`);
  diags.dispose();

  // 4. Git: estado del repositorio y mensaje de commit en el cuadro de Control de código fuente.
  let st = await api.git.status();
  for (let i = 0; i < 20 && (st.status !== "repo" || !st.changes); i++) {
    await sleep(500);
    st = await api.git.status();
  }
  check(
    st.status === "repo" && st.name === "edgar/demo" && st.branch === "main" && st.remote?.isGitHub && st.changes >= 1,
    `git: ${JSON.stringify({ status: st.status, name: st.name, branch: st.branch, remote: st.remote?.web, changes: st.changes })}`,
  );
  await vscode.commands.executeCommand("ghostcode.commitMessage");
  const gitApi = vscode.extensions.getExtension<any>("vscode.git")!.exports.getAPI(1);
  const box = gitApi.repositories[0]?.inputBox.value;
  check(box === "feat(demo): añade la función sumar\n\n- Agrega sumar a main.js" && /diff --git a\/src\/main\.js/.test(chats.at(-1) ?? ""), `mensaje de commit: ${JSON.stringify(box)}`);
  const panelGit = (await api.panel.state()).git;
  check(panelGit?.name === "edgar/demo", `panel → git: ${panelGit?.name} · ${panelGit?.branch}`);

  // 5. Explicar SQL y regex al pasar el puntero.
  const lit = await open("php", '<?php\n$q = "SELECT * FROM usuarios WHERE activo = 1";\nif (preg_match(\'/^\\w+@\\w+\\.com$/\', $email)) {}\n');
  const hoverText = async (line: number, ch: number) => {
    const hs = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", lit.document.uri, new vscode.Position(line, ch));
    return hs.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).find((t) => t.includes("GhostCode"));
  };
  const sql = await hoverText(1, 12);
  check(Boolean(sql?.includes("consulta SQL") && sql.includes("usuarios activos")), `hover SQL: ${JSON.stringify(sql)}`);
  const re = await hoverText(2, 20);
  check(Boolean(re?.includes("expresión regular") && re.includes("- `\\w+` — una o más letras")), `hover regex: ${JSON.stringify(re)}`);
}

/** Rename, rutas, Halo IA, prompts, contexto del proyecto, extensiones e indentación con N espacios. */
async function newTools(out: string[], prompts: string[], fail: () => void): Promise<void> {
  const check = (ok: boolean, msg: string) => {
    if (!ok) fail();
    out.push(`${ok ? "✔" : "✘"} ${msg}`);
  };
  const ws = vscode.workspace.workspaceFolders![0].uri;
  const api = vscode.extensions.getExtension("edgar.ghostcode")!.exports as {
    provider: vscode.InlineCompletionItemProvider;
    halo: { list(): { name: string; files: number; functions: number; styleTags: string[]; summary?: string }[] };
    panel: { state(): Promise<any> };
  };

  // Rename: sugerencias del modelo en la convención del archivo (camelCase) y renombrado con el proveedor de TS.
  const js = await open("javascript", "function f(a, b) {\n  return a + b;\n}\nconsole.log(f(1, 2));\n");
  js.selection = new vscode.Selection(1, 2, 1, 2);
  await vscode.commands.executeCommand("ghostcode.rename", { pick: 0 });
  check(js.document.getText() === "function sumarNumeros(a, b) {\n  return a + b;\n}\nconsole.log(sumarNumeros(1, 2));\n", `rename: ${JSON.stringify(js.document.getText())}`);

  // Corrección de rutas: href roto en un HTML del proyecto, marcado y corregido con la acción rápida.
  const html = await open("index.html");
  let diags: vscode.Diagnostic[] = [];
  for (let i = 0; i < 20 && !diags.length; i++) {
    await sleep(300);
    diags = vscode.languages.getDiagnostics(html.document.uri).filter((d) => d.source === "GhostCode");
  }
  check(diags.length === 1 && diags[0].message.includes("css/estilo.css") && diags[0].message.includes("css/estilos.css"), `rutas: ${JSON.stringify(diags.map((d) => d.message))}`);
  const fixes = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", html.document.uri, diags[0]?.range ?? new vscode.Range(0, 0, 0, 0));
  const pathFix = fixes.find((a) => a.title.includes("corregir ruta"));
  if (pathFix?.edit) await vscode.workspace.applyEdit(pathFix.edit);
  check(html.document.getText().includes('href="css/estilos.css"') && html.document.getText().includes('src="js/app.js"'), `rutas → corregida: ${JSON.stringify(html.document.lineAt(3).text.trim())}`);
  const panelState = await api.panel.state();
  check(Boolean(panelState.version) && panelState.brokenShown === false, `panel: versión ${panelState.version} y lista de rutas plegada`);

  // «Mostrar rutas rota(s)»: lista con la sugerencia y «Corregir» desde el panel.
  const paths = (vscode.extensions.getExtension("edgar.ghostcode")!.exports as {
    paths: {
      checkProject(o: { quiet: boolean }): Promise<void>;
      broken(): { file: string; line: number; start: number; end: number; uri: string; value: string; suggestion?: string }[];
      open(b: { uri: string; line: number; start: number; end: number }, replacement?: string): Promise<void>;
    };
  }).paths;
  await html.edit((eb) => {
    const at = html.document.getText().indexOf("js/app.js");
    eb.replace(new vscode.Range(html.document.positionAt(at), html.document.positionAt(at + "js/app.js".length)), "js/ap.js");
  });
  await paths.checkProject({ quiet: true });
  const listed = paths.broken();
  check(
    listed.length === 1 && listed[0].file === "index.html" && listed[0].value === "js/ap.js" && listed[0].suggestion === "js/app.js",
    `mostrar rutas rotas: ${JSON.stringify(listed.map((b) => `${b.file}:${b.line + 1} ${b.value} → ${b.suggestion}`))}`,
  );
  if (listed[0]) await paths.open(listed[0], listed[0].suggestion);
  check(html.document.getText().includes('src="js/app.js"') && paths.broken().length === 0, `«Corregir» desde la lista: ${JSON.stringify(html.document.lineAt(4).text.trim())}`);

  // Halo IA: analizar el propio proyecto de prueba.
  prompts.length = 0;
  await vscode.commands.executeCommand("ghostcode.halo.analyze", ws.fsPath);
  const h = api.halo.list()[0];
  check(Boolean(h && h.files >= 2 && h.styleTags.includes("2 espacios") && h.summary?.includes("herencia")), `halo: ${JSON.stringify(h && { name: h.name, files: h.files, functions: h.functions, tags: h.styleTags, summary: h.summary })}`);
  const draft = await open("javascript", "export class Cuadrado extends Figura {\n  constructor(lado) {\n    super();\n    this.lado = lado;\n  }\n  ");
  const endPos = draft.document.lineAt(draft.document.lineCount - 1).range.end;
  await api.provider.provideInlineCompletionItems(draft.document, endPos, { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined }, new vscode.CancellationTokenSource().token);
  const prompt = prompts.at(-1) ?? "";
  check(/\/\/ Style: 2-space indentation/.test(prompt) && /Compare this snippet from Halo IA · /.test(prompt), `halo → prompt: ${JSON.stringify(prompt.split("\nexport class Cuadrado")[0].slice(0, 300))}`);

  // Prompt de la selección: generar, copiar y guardar en PROMPTS.md.
  const sel = await open("javascript", "function sumar(a, b) {\n  return a + b;\n}\n");
  sel.selection = new vscode.Selection(0, 0, 2, 1);
  const p = await vscode.commands.executeCommand<{ text: string; source: string }>("ghostcode.prompt.fromSelection");
  check(Boolean(p?.text.startsWith("**Objetivo**: Sumar dos números.") && p.text.includes("```javascript\nfunction sumar(a, b)")), `prompt: ${JSON.stringify(p?.text.slice(0, 120))}`);
  await vscode.commands.executeCommand("ghostcode.prompt.copy");
  check((await vscode.env.clipboard.readText()) === p?.text, "prompt → copiado al portapapeles");
  await vscode.commands.executeCommand("ghostcode.prompt.save");
  const md = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ws, "PROMPTS.md")));
  check(md.startsWith("# Prompts del proyecto") && md.includes("## Sumar dos números.") && md.includes("origen: `Untitled"), `PROMPTS.md: ${JSON.stringify(md.slice(0, 160))}`);

  // Prompt y contexto del proyecto.
  await vscode.commands.executeCommand("ghostcode.projectContext");
  const ctx = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ws, "PROJECT-CONTEXT.md")));
  check(
    ctx.includes("## De qué trata\n\nUn proyecto de prueba") && ctx.includes("| JavaScript |") && ctx.includes("## Estructura") && ctx.includes("src/"),
    `PROJECT-CONTEXT.md: ${JSON.stringify(ctx.slice(0, 200))}`,
  );

  // Extensiones recomendadas para un proyecto JS + HTML + CSS con git.
  const st = await api.panel.state();
  const recs: { id: string; installed: boolean }[] = st.extensions?.recs ?? [];
  check(["dbaeumer.vscode-eslint", "eamodio.gitlens", "ecmel.vscode-html-css"].every((id) => recs.some((r) => r.id === id)), `extensiones: ${recs.map((r) => r.id).join(", ")}`);

  // Corregir indentación con 2 espacios por nivel (archivo con 4).
  const ind = await open("javascript", "function g(x) {\n    if (x) {\n        return 1;\n    }\n}\n");
  await vscode.commands.executeCommand("ghostcode.fixIndentation", 2);
  check(ind.document.getText() === "function g(x) {\n  if (x) {\n    return 1;\n  }\n}\n", `indentación con 2 espacios: ${JSON.stringify(ind.document.getText())}`);
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("edgar.ghostcode")!;
  const api = (await ext.activate()) as { provider: vscode.InlineCompletionItemProvider; ready: Promise<void> };
  await api.ready;
  const out: string[] = [];
  let failed = false;
  for (const c of CASES) {
    const doc = await vscode.workspace.openTextDocument({ language: c.language, content: c.content });
    await vscode.window.showTextDocument(doc);
    const t0 = Date.now();
    const items = (await api.provider.provideInlineCompletionItems(
      doc,
      new vscode.Position(c.line, c.ch),
      { triggerKind: vscode.InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined },
      new vscode.CancellationTokenSource().token,
    )) as vscode.InlineCompletionItem[] | undefined;
    const text = items?.[0]?.insertText;
    if (typeof text !== "string" || !text.trim()) failed = true;
    out.push(`${failed ? "✘" : "✔"} ${c.language} (${Date.now() - t0} ms): ${JSON.stringify(text)}`);
  }

  // Herramientas: corregir indentación.
  const tools = [
    {
      name: "indentación JS (archivo)",
      language: "javascript",
      content: "function f(a) {\nif (a) {\nreturn 1;\n}\nreturn 2;\n}\n",
      expected: "function f(a) {\n    if (a) {\n        return 1;\n    }\n    return 2;\n}\n",
    },
    {
      // Python: no se deben mover líneas entre bloques, solo unificar tabs/espacios.
      name: "indentación Python (no cambia bloques)",
      language: "python",
      content: "def f():\n\treturn 1\nx = 2\n",
      expected: "def f():\n    return 1\nx = 2\n",
    },
  ];
  for (const t of tools) {
    const doc = await vscode.workspace.openTextDocument({ language: t.language, content: t.content });
    const editor = await vscode.window.showTextDocument(doc);
    editor.options = { tabSize: 4, insertSpaces: true };
    await vscode.commands.executeCommand("ghostcode.fixIndentation");
    const ok = doc.getText() === t.expected;
    if (!ok) failed = true;
    out.push(`${ok ? "✔" : "✘"} ${t.name}: ${JSON.stringify(doc.getText())}`);
  }

  // Anotaciones de punta a punta contra un Ollama simulado (sin descargar modelos).
  const prompts: string[] = [];
  const chats: string[] = [];
  const fake = createServer((req, res) => {
    if (req.url === "/api/tags") {
      return void res.end(JSON.stringify({ models: [{ name: "qwen2.5-coder:1.5b-base", size: 1e9 }, { name: "qwen2.5-coder:1.5b", size: 1e9 }] }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body);
      if (req.url === "/api/generate") {
        prompts.push(data.prompt ?? "");
        return void res.end(JSON.stringify({ response: "radio;", done: true }) + "\n");
      }
      const system: string = data.messages?.[0]?.content ?? "";
      const user: string = data.messages?.[1]?.content ?? "";
      chats.push(user);
      let content = `\`\`\`\n// Calcula el factorial (${data.model}).\n\`\`\``;
      if (system.includes("reference documentation")) {
        content = JSON.stringify({
          summary: "Suma dos números.",
          params: [{ name: "a", type: "number", description: "Primer sumando" }, { name: "b", type: "number", description: "Segundo sumando" }],
          returns: { type: "number", description: "La suma" },
        });
      } else if (system.includes("compiler or linter")) {
        const block = /<block>\n([\s\S]*)\n<\/block>/.exec(user)![1];
        content = "```\n" + block.replace("retrun", "return") + "\n```\nSe corrigió la palabra return.";
      } else if (system.includes("commit message")) {
        content = "feat(demo): añade la función sumar\n\n- Agrega sumar a main.js";
      } else if (system.includes("SQL query")) {
        content = "Obtiene todos los usuarios activos de la tabla usuarios.";
      } else if (system.includes("regular expression")) {
        content = "Reconoce un correo electrónico.\n\\w+ — una o más letras\n@ — la arroba";
      } else if (system.includes("Suggest better names")) {
        content = '[{"name":"sumar_numeros","reason":"Suma dos números"},{"name":"calcular total","reason":"Calcula el total"}]';
      } else if (system.includes("reusable prompt")) {
        content = "**Objetivo**: Sumar dos números.\n\n**Comportamiento**\n- Devuelve a + b";
      } else if (system.includes("document a software project")) {
        content = "## De qué trata\n\nUn proyecto de prueba con geometría.\n\n## Objetivo\n\nProbar GhostCode.";
      } else if (system.includes("how a developer writes code")) {
        content = "- Usa clases con herencia (Circulo extends Figura)\n- Nombres en español";
      }
      res.end(JSON.stringify({ message: { content }, done: true }) + "\n");
    });
  });
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  const ghost = vscode.workspace.getConfiguration("ghostcode");
  await ghost.update("local.url", `http://127.0.0.1:${(fake.address() as AddressInfo).port}`, vscode.ConfigurationTarget.Global);
  await ghost.update("mode", "local", vscode.ConfigurationTarget.Global);
  const pyDoc = await vscode.workspace.openTextDocument({ language: "python", content: "x = 1\n    def factorial(n):\n        return 1\n" });
  const pyEditor = await vscode.window.showTextDocument(pyDoc);
  pyEditor.selection = new vscode.Selection(1, 4, 2, 16);
  await vscode.commands.executeCommand("ghostcode.annotate");

  // Explicación al pasar el puntero: declaración, uso (definición) y variable (nada).
  const jsDoc = await vscode.workspace.openTextDocument({
    language: "javascript",
    content: "function sumar(a, b) {\n  const total = a + b;\n  return total;\n}\n\nconsole.log(sumar(1, 2));\n",
  });
  await vscode.window.showTextDocument(jsDoc);
  // Esperar a que el servidor de TypeScript esté listo (da los símbolos del documento).
  for (let i = 0; i < 40; i++) {
    const syms = await vscode.commands.executeCommand<unknown[]>("vscode.executeDocumentSymbolProvider", jsDoc.uri);
    if (syms?.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const ghostHover = async (line: number, ch: number) => {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", jsDoc.uri, new vscode.Position(line, ch));
    const texts = hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value)));
    return texts.find((t) => t.includes("GhostCode"));
  };
  for (const [name, line, ch, expect] of [
    ["declaración", 0, 11, true],
    ["uso (llamada)", 5, 14, true],
    ["variable local", 1, 9, false],
  ] as const) {
    const h = await ghostHover(line, ch);
    const ok = expect ? Boolean(h?.includes("Calcula el factorial") && h.includes("function `sumar`")) : h === undefined;
    if (!ok) failed = true;
    out.push(`${ok ? "✔" : "✘"} hover ${name}: ${JSON.stringify(h ?? "sin explicación")}`);
  }
  // «Insertar como comentario» desde el hover.
  await vscode.commands.executeCommand("ghostcode.insertExplanation", { uri: jsDoc.uri.toString(), line: 0, lines: ["Suma dos números."] });
  const inserted = jsDoc.lineAt(0).text === "// Suma dos números." && jsDoc.lineAt(1).text.startsWith("function sumar");
  if (!inserted) failed = true;
  out.push(`${inserted ? "✔" : "✘"} hover → insertar como comentario: ${JSON.stringify(jsDoc.getText().split("\n").slice(0, 2))}`);
  const annotated = pyDoc.getText() === "x = 1\n    # Calcula el factorial (qwen2.5-coder:1.5b).\n    def factorial(n):\n        return 1\n";
  if (!annotated) failed = true;
  out.push(`${annotated ? "✔" : "✘"} anotación: ${JSON.stringify(pyDoc.getText())}`);

  await toolsInWorkspace(out, prompts, chats, () => (failed = true));
  await newTools(out, prompts, () => (failed = true));
  fake.close();

  // Panel lateral: el contenedor y la vista existen y se pueden abrir.
  try {
    await vscode.commands.executeCommand("workbench.view.extension.ghostcode");
    out.push("✔ panel lateral abierto");
  } catch (err) {
    failed = true;
    out.push(`✘ panel lateral: ${(err as Error).message}`);
  }
  const { detectHardware } = await import("../src/hardware");
  out.push(`ℹ hardware: ${JSON.stringify(await detectHardware())}`);

  writeFileSync(process.env.GHOSTCODE_RESULTS ?? "out/integration-results.txt", out.join("\n") + "\n");
  if (failed) throw new Error("Alguna prueba no devolvió sugerencia");
}

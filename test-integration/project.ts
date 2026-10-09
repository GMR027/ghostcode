// Prueba en un proyecto real, con la configuración y extensiones del usuario.
// Trabaja sobre copias de los archivos en una carpeta temporal: el proyecto no se modifica.
// Uso: npm run test:project -- /ruta/al/proyecto
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as vscode from "vscode";

const PROJECT = process.env.GHOSTCODE_PROJECT!;
/** GHOSTCODE_ONLY=hover (u otra sección) ejecuta solo esa parte. */
const ONLY = process.env.GHOSTCODE_ONLY;
const runs = (section: string) => !ONLY || ONLY === section;
const WORK = mkdtempSync(join(tmpdir(), "ghostcode-project-"));
const out: string[] = [];
let failed = false;

function report(ok: boolean | "info", msg: string): void {
  if (ok === false) failed = true;
  out.push(`${ok === "info" ? "ℹ" : ok ? "✔" : "✘"} ${msg}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copia `file` del proyecto a la carpeta temporal (aplicando `edit`) y lo abre. */
let copies = 0;

async function openCopy(file: string, edit: (text: string) => string = (t) => t): Promise<vscode.TextEditor> {
  // Ruta nueva en cada copia: VS Code guarda en memoria los documentos recién cerrados.
  const dest = join(WORK, String(copies++), file);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, edit(readFileSync(join(PROJECT, file), "utf8")));
  const doc = await vscode.workspace.openTextDocument(dest);
  return vscode.window.showTextDocument(doc);
}

/**
 * Borra una línea real del proyecto y comprueba, a través del propio VS Code
 * (trigger + Tab), que GhostCode muestra una sugerencia y que se puede aceptar.
 */
async function ghostText(file: string, marker: string): Promise<{ inserted?: string; expected: string; ms: number }> {
  const lines = readFileSync(join(PROJECT, file), "utf8").split("\n");
  const idx = lines.findIndex((l) => l.includes(marker));
  if (idx < 0) throw new Error(`No se encontró «${marker}» en ${file}`);
  const expected = lines[idx].trim();
  const indent = /^\s*/.exec(lines[idx])![0];
  const editor = await openCopy(file, () => [...lines.slice(0, idx), indent, ...lines.slice(idx + 1)].join("\n"));
  const doc = editor.document;
  const pos = new vscode.Position(idx, indent.length);
  editor.selection = new vscode.Selection(pos, pos);
  const before = doc.getText();
  const t0 = Date.now();
  await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
  while (Date.now() - t0 < 30_000 && doc.getText() === before) {
    await sleep(200);
    await vscode.commands.executeCommand("editor.action.inlineSuggest.commit");
  }
  const ms = Date.now() - t0;
  const after = doc.getText();
  const offset = doc.offsetAt(pos);
  const inserted = after === before ? undefined : after.slice(offset, offset + after.length - before.length);
  if (inserted === undefined) {
    // Diagnóstico: ¿el proveedor no devolvió nada (el modelo solo repetía código existente) o VS Code no lo mostró?
    const items = (await api().provider.provideInlineCompletionItems(
      doc, pos, { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
      new vscode.CancellationTokenSource().token,
    )) as vscode.InlineCompletionItem[] | undefined;
    report("info", `   diagnóstico: el proveedor ahora devuelve ${JSON.stringify(items?.[0]?.insertText ?? "nada")}`);
  }
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  return { inserted, expected, ms };
}

/** Aplica «Corregir indentación» y devuelve el texto resultante. */
async function fixIndent(file: string, edit?: (t: string) => string, select?: (doc: vscode.TextDocument) => vscode.Selection): Promise<string> {
  const editor = await openCopy(file, edit);
  if (select) editor.selection = select(editor.document);
  await vscode.commands.executeCommand("ghostcode.fixIndentation");
  await sleep(300);
  const text = editor.document.getText();
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  return text;
}

const stripIndent = (t: string) => t.replace(/^[ \t]+/gm, "");
// Las líneas que solo tienen espacios no importan para comparar sangrías.
const blankWs = (t: string) => t.replace(/^[ \t]+$/gm, "");

type Api = {
  ready: Promise<void>;
  provider: vscode.InlineCompletionItemProvider;
  panel: { refreshModels(): Promise<void>; state(): Promise<any> };
  git: { status(): Promise<any> };
  project: { ensure(): Promise<void>; fileCount: number };
  halo: { list(): { name: string; files: number; functions: number; styleTags: string[]; summary?: string }[] };
};
const api = () => vscode.extensions.getExtension("edgar.ghostcode")!.exports as Api;

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("edgar.ghostcode")!;
  await ext.activate();
  await api().ready;

  // --- Entorno -------------------------------------------------------------------
  const disableAI = vscode.workspace.getConfiguration("chat").get("disableAIFeatures");
  report("info", `chat.disableAIFeatures (Copilot desactivado) = ${disableAI}`);
  const copilot = vscode.extensions.all.filter((e) => /copilot/i.test(e.id)).map((e) => `${e.id}${e.isActive ? " (activa)" : ""}`);
  report("info", `extensiones Copilot: ${copilot.join(", ") || "ninguna"}`);
  const others = vscode.extensions.all.filter((e) => !e.id.startsWith("vscode.") && e.id !== ext.id).map((e) => e.id);
  report("info", `otras extensiones cargadas: ${others.join(", ") || "ninguna"}`);
  report(vscode.workspace.getConfiguration("editor").get("inlineSuggest.enabled") === true, "editor.inlineSuggest.enabled = true");
  const g = vscode.workspace.getConfiguration("ghostcode");
  report(g.get("mode") === "local", `modo GhostCode = ${g.get("mode")} · modelo = ${g.get("local.model")}`);

  const cases: [string, string][] = [
    ["models/Usuario.php", "'El apellido es obligatorio'"],
    ["models/ActiveRecord.php", '$query = "SELECT * FROM " . static::$tabla;'],
    ["controllers/ApiController.php", "$recordatorios = TipoRecordatorio::all();"],
    ["views/auth/login.php", '<label for="password">Password</label>'],
    ["src/js/app.js", "seccionAnterior.classList.remove('mostrar');"],
    ["src/sass/base/_globales.scss", "max-width: 1200px;"],
  ];
  if (runs("ghost")) {
  // --- Ghost text de punta a punta, en archivos reales del proyecto ---------------
  // La primera petición carga el modelo en la GPU.
  await ghostText(cases[0][0], cases[0][1]).catch(() => undefined);
  for (const [file, marker] of cases) {
    const r = await ghostText(file, marker);
    const first = r.inserted?.split("\n")[0].trim() ?? "";
    const exact = first === r.expected;
    report(r.inserted !== undefined, `ghost text ${file} (${r.ms} ms): ${JSON.stringify(r.inserted ?? "sin sugerencia")}`);
    report("info", `   ${exact ? "idéntica al original" : `original: ${JSON.stringify(r.expected)}`}`);
  }

  }
  if (runs("toggle")) {
  // --- Activar / desactivar -------------------------------------------------------
  await vscode.commands.executeCommand("ghostcode.toggle");
  await sleep(500);
  const off = await ghostText(cases[0][0], cases[0][1]).catch(() => ({ inserted: "error" }) as { inserted?: string });
  report(off.inserted === undefined, `desactivado: no sugiere nada (${JSON.stringify(off.inserted ?? "sin sugerencia")})`);
  await vscode.commands.executeCommand("ghostcode.toggle");
  await sleep(500);
  report(vscode.workspace.getConfiguration("ghostcode").get("mode") === "local", "reactivado en modo local");

  }
  if (runs("indent")) {
  // --- Corregir indentación ------------------------------------------------------
  for (const file of ["src/js/app.js", "models/Usuario.php", "views/auth/login.php", "src/sass/base/_globales.scss"]) {
    const reference = blankWs(await fixIndent(file));
    const fixed = blankWs(await fixIndent(file, stripIndent));
    const bad = fixed.split("\n").findIndex((l, i) => l !== reference.split("\n")[i]);
    const original = readFileSync(join(PROJECT, file), "utf8");
    report(stripIndent(fixed) === stripIndent(original), `indentación ${file}: solo cambia espacios al inicio de línea (comillas, llaves, etc. intactas)`);
    report(
      fixed === reference,
      `indentación ${file} (sin sangría → corregido = original corregido)${bad >= 0 ? ` difiere en línea ${bad + 1}: ${JSON.stringify(fixed.split("\n")[bad])} vs ${JSON.stringify(reference.split("\n")[bad])}` : ""}`,
    );
  }
  {
    // Solo la función all() de ActiveRecord.php, seleccionada.
    const file = "models/ActiveRecord.php";
    const original = readFileSync(join(PROJECT, file), "utf8").split("\n");
    const start = original.findIndex((l) => l.includes("public static function all()"));
    const end = start + 4;
    const strip = (t: string) => t.split("\n").map((l, i) => (i >= start && i <= end ? l.trimStart() : l)).join("\n");
    const select = (doc: vscode.TextDocument) => new vscode.Selection(start, 0, end, doc.lineAt(end).text.length);
    const reference = (await fixIndent(file, undefined, select)).split("\n");
    const fixed = (await fixIndent(file, strip, select)).split("\n");
    const region = fixed.slice(start, end + 1);
    const ok = region.join("\n") === reference.slice(start, end + 1).join("\n") && fixed.slice(0, start).join("\n") === original.slice(0, start).join("\n");
    report(ok, `indentación ${file} (solo selección): ${JSON.stringify(region)}`);
  }

  }
  if (runs("annotate")) {
  // --- Anotaciones con el modelo real -------------------------------------------
  for (const [file, marker] of [
    ["models/Usuario.php", "public function validarIngreso()"],
    ["src/js/app.js", "function mostrarSeccion()"],
  ] as const) {
    const editor = await openCopy(file);
    const doc = editor.document;
    const start = doc.getText().split("\n").findIndex((l) => l.includes(marker));
    // Hasta la llave que cierra la función (primera línea con la misma sangría que empieza con "}").
    const indent = /^\s*/.exec(doc.lineAt(start).text)![0];
    let end = start + 1;
    while (end < doc.lineCount - 1 && doc.lineAt(end).text !== `${indent}}`) end++;
    editor.selection = new vscode.Selection(start, 0, end, doc.lineAt(end).text.length);
    const lineCount = doc.lineCount;
    const t0 = Date.now();
    await vscode.commands.executeCommand("ghostcode.annotate");
    const added = doc.lineCount - lineCount;
    const comment = Array.from({ length: added }, (_, i) => doc.lineAt(start + i).text);
    const looksOk = added > 0 && comment.every((l) => l.startsWith(`${indent}//`));
    const spanish = /\b(el|la|los|las|que|de|se|una?|para|si)\b/i.test(comment.join(" "));
    report(looksOk, `anotación ${file} (${Date.now() - t0} ms, ${added} líneas):\n${comment.map((l) => `     ${l}`).join("\n")}`);
    if (!looksOk) report("info", `   indent=${JSON.stringify(indent)} líneas=${JSON.stringify(comment)}`);
    report(spanish, "   en español");
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }

  }
  if (runs("hover")) {
  // --- Explicación al pasar el puntero (modelo real + proveedores de símbolos del usuario) ---
  const hoverCases: [string, string, string, string, boolean][] = [
    ["models/Usuario.php", "public function validarIngreso()", "validarIngreso", "declaración PHP", true],
    ["controllers/LoginController.php", "$ingreso->validarIngreso()", "validarIngreso", "uso PHP → definición en models/Usuario.php", true],
    ["src/js/app.js", "  mostrarSeccion();", "mostrarSeccion", "uso JS → definición en el mismo archivo", true],
    ["controllers/LoginController.php", "$alertas = $ingreso->validarIngreso();", "$alertas", "variable (no debe explicar)", false],
  ];
  for (const [file, marker, word, label, expect] of hoverCases) {
    const editor = await openCopy(file);
    const doc = editor.document;
    const line = doc.getText().split("\n").findIndex((l) => l.includes(marker));
    const pos = new vscode.Position(line, doc.lineAt(line).text.indexOf(word) + 2);
    const ghost = async () => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, pos);
      return hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).find((t) => t.includes("GhostCode"));
    };
    let t0 = Date.now();
    let text = await ghost();
    // Intelephense puede tardar en indexar el proyecto la primera vez.
    for (let i = 0; expect && !text && i < 6; i++) {
      await sleep(3000);
      t0 = Date.now();
      text = await ghost();
    }
    const first = Date.now() - t0;
    t0 = Date.now();
    await ghost();
    const cached = Date.now() - t0;
    if (expect && !text) {
      const defs = await vscode.commands.executeCommand<any[]>("vscode.executeDefinitionProvider", doc.uri, pos);
      const syms = await vscode.commands.executeCommand<any[]>("vscode.executeDocumentSymbolProvider", doc.uri);
      report("info", `   diagnóstico: definiciones=${JSON.stringify(defs?.map((d) => [(d.targetUri ?? d.uri).path, (d.targetSelectionRange ?? d.range)?.start]))} símbolos=${syms?.length}`);
    }
    const body = text?.split("\n\n")[1]?.replace(/\\(.)/g, "$1");
    report(expect ? Boolean(body) : text === undefined, `hover ${label} (${first} ms, en caché ${cached} ms): ${JSON.stringify(body ?? "sin explicación")}`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }

  }
  if (runs("context")) {
  // --- Contexto del proyecto: escribir `TipoRecordatorio::` y ver qué propone -------------
  await api().project.ensure();
  report("info", `índice del proyecto: ${api().project.fileCount} archivos`);
  for (const [file, marker, typed] of [
    ["controllers/ApiController.php", "$recordatorios = TipoRecordatorio::all();", "$recordatorios = TipoRecordatorio::"],
    ["controllers/LoginController.php", "$alertas = $ingreso->validarIngreso();", "$alertas = $ingreso->"],
  ] as const) {
    const editor = await openCopy(file, (t) => t.replace(marker, typed));
    const doc = editor.document;
    const line = doc.getText().split("\n").findIndex((l) => l.includes(typed));
    const pos = new vscode.Position(line, doc.lineAt(line).text.indexOf(typed) + typed.length);
    const items = (await api().provider.provideInlineCompletionItems(
      doc, pos, { triggerKind: vscode.InlineCompletionTriggerKind.Invoke, selectedCompletionInfo: undefined },
      new vscode.CancellationTokenSource().token,
    )) as vscode.InlineCompletionItem[] | undefined;
    const got = String(items?.[0]?.insertText ?? "");
    const real = marker.slice(typed.length);
    report(got.startsWith(real.replace(/\(.*$/, "")), `contexto ${file}: «${typed}» → ${JSON.stringify(got)} (en el proyecto: ${JSON.stringify(real)})`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  }
  if (runs("document")) {
  // --- Documentar función con el modelo real ----------------------------------------------
  for (const [file, marker] of [
    ["models/Usuario.php", "public function validarIngreso()"],
    ["models/ActiveRecord.php", "public static function where($columna, $valor)"],
    ["src/js/app.js", "function mostrarSeccion()"],
  ] as const) {
    const editor = await openCopy(file);
    const doc = editor.document;
    const line = doc.getText().split("\n").findIndex((l) => l.includes(marker));
    editor.selection = new vscode.Selection(line + 1, 4, line + 1, 4);
    const before = doc.lineCount;
    const t0 = Date.now();
    await vscode.commands.executeCommand("ghostcode.documentFunction");
    const added = doc.lineCount - before;
    const block = Array.from({ length: added }, (_, i) => doc.lineAt(line + i).text);
    report(added > 2 && /^\s*\/\*\*/.test(block[0]) && /\*\/\s*$/.test(block.at(-1)!), `documentar ${file} (${Date.now() - t0} ms):\n${block.map((l) => `     ${l}`).join("\n")}`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  }
  if (runs("fix")) {
  // --- Arreglar error con IA: errores reales de Intelephense / TypeScript ----------------
  await vscode.workspace.getConfiguration("ghostcode").update("fixPreview", false, vscode.ConfigurationTarget.Global);
  for (const [file, good, bad] of [
    ["models/Usuario.php", "$this->email = $args['email'] ?? '';", "$this->email = $args['email'] ?? ''"],
    ["src/js/app.js", "seccionAnterior.classList.remove('mostrar');", "seccionAnterior.classList.remove('mostrar';"],
  ] as const) {
    const editor = await openCopy(file, (t) => t.replace(good, bad));
    const doc = editor.document;
    // Esperar a que el lenguaje publique el error.
    let diags: vscode.Diagnostic[] = [];
    for (let i = 0; i < 40 && !diags.length; i++) {
      await sleep(500);
      diags = vscode.languages.getDiagnostics(doc.uri).filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    }
    const line = doc.getText().split("\n").findIndex((l) => l.includes(bad));
    editor.selection = new vscode.Selection(line, 0, line, 0);
    const t0 = Date.now();
    await vscode.commands.executeCommand("ghostcode.fixWithAI");
    const fixed = doc.getText();
    const original = readFileSync(join(PROJECT, file), "utf8");
    const diff = fixed.split("\n").filter((l, i) => l !== original.split("\n")[i]);
    report(fixed === original, `arreglar ${file} (${Date.now() - t0} ms, error: ${JSON.stringify(diags[0]?.message ?? "ninguno")}): líneas distintas al original = ${JSON.stringify(diff)}`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  }
  if (runs("sql")) {
  // --- Explicar SQL al pasar el puntero ----------------------------------------------------
  const editor = await openCopy("models/ActiveRecord.php");
  const doc = editor.document;
  for (const marker of ['" WHERE id = {$id}"', '" WHERE {$columna} = \'{$valor}\'"', '" INSERT INTO "']) {
    const line = doc.getText().split("\n").findIndex((l) => l.includes(marker));
    const pos = new vscode.Position(line, doc.lineAt(line).text.indexOf(marker) + 3);
    const t0 = Date.now();
    const hs = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, pos);
    const text = hs.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).find((t) => t.includes("GhostCode"));
    report(Boolean(text?.includes("consulta SQL")), `hover SQL ${marker} (${Date.now() - t0} ms): ${JSON.stringify(text?.split("\n\n")[1]?.replace(/\\(.)/g, "$1") ?? "sin explicación")}`);
  }
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  if (runs("git")) {
  // --- Git: el proyecto no es un repositorio; un repositorio temporal para el commit --------
  const st = await api().git.status();
  report(st.status === "no-repo", `git (recordatorios): ${JSON.stringify(st)}`);
  const repoDir = join(WORK, "repo-demo");
  mkdirSync(join(repoDir, "models"), { recursive: true });
  writeFileSync(join(repoDir, "models/Usuario.php"), readFileSync(join(PROJECT, "models/Usuario.php"), "utf8"));
  const sh = (cmd: string) => require("node:child_process").execSync(cmd, { cwd: repoDir, stdio: "pipe" });
  sh("git init -q -b main && git add -A && git -c user.name=p -c user.email=p@example.com commit -qm init");
  const usuario = readFileSync(join(repoDir, "models/Usuario.php"), "utf8");
  writeFileSync(join(repoDir, "models/Usuario.php"), usuario.replace("public function validarIngreso() {", "public function nombreCompleto() {\n    return trim($this->nombre . ' ' . $this->apellido);\n  }\n\n  public function validarIngreso() {"));
  await vscode.commands.executeCommand("git.openRepository", repoDir);
  await vscode.window.showTextDocument(vscode.Uri.file(join(repoDir, "models/Usuario.php")));
  const gitApi = vscode.extensions.getExtension<any>("vscode.git")!.exports.getAPI(1);
  for (let i = 0; i < 20; i++) {
    const r = gitApi.repositories.find((x: any) => x.rootUri.fsPath === repoDir);
    if (r?.state.workingTreeChanges.length) break;
    await sleep(500);
  }
  const t0 = Date.now();
  await vscode.commands.executeCommand("ghostcode.commitMessage");
  const box = gitApi.repositories.find((x: any) => x.rootUri.fsPath === repoDir)?.inputBox.value ?? "";
  report(/^(feat|fix|refactor|docs|chore|style|perf|test)(\(.+\))?: .+/.test(box), `mensaje de commit real (${Date.now() - t0} ms):\n${box.split("\n").map((l: string) => `     ${l}`).join("\n")}`);
  }
  if (runs("rename")) {
  // --- Rename: sugerencias reales (PHP, sin aplicar) y renombrado real en una copia de JS ----
  {
    const editor = await openCopy("models/Usuario.php");
    const line = editor.document.getText().split("\n").findIndex((l) => l.includes("public function validarIngreso()"));
    const col = editor.document.lineAt(line).text.indexOf("validarIngreso");
    editor.selection = new vscode.Selection(line, col, line, col + "validarIngreso".length);
    const t0 = Date.now();
    const sug = (await vscode.commands.executeCommand<{ name: string; reason: string }[]>("ghostcode.rename", { dryRun: true })) ?? [];
    report(sug.length > 0 && sug.every((x) => /^[a-z][A-Za-z0-9]*$/.test(x.name)), `rename (PHP, ${Date.now() - t0} ms): ${sug.map((x) => `${x.name} — ${x.reason}`).join(" | ")}`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  {
    const editor = await openCopy("src/js/app.js");
    const doc = editor.document;
    const line = doc.getText().split("\n").findIndex((l) => l.includes("function botonespaginacion()"));
    const col = doc.lineAt(line).text.indexOf("botonespaginacion");
    editor.selection = new vscode.Selection(line, col, line, col + "botonespaginacion".length);
    const before = (doc.getText().match(/\bbotonespaginacion\b/g) ?? []).length;
    await vscode.commands.executeCommand("ghostcode.rename", { pick: 0 });
    const after = (doc.getText().match(/\bbotonespaginacion\b/g) ?? []).length;
    const newName = /function (\w+)\(\) \{\n  const btnSiguiente/.exec(doc.getText())?.[1];
    const uses = newName ? (doc.getText().match(new RegExp(`\\b${newName}\\b`, "g")) ?? []).length : 0;
    report(after === 0 && uses === before, `rename (JS, ${before} usos): botonespaginacion → ${newName} (${uses} usos renombrados)`);
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  }
  if (runs("paths")) {
  // --- Corrección de rutas: todo el proyecto (solo lectura) y arreglos en memoria ----------
  await vscode.workspace.getConfiguration("ghostcode").update("pathCheck", true, vscode.ConfigurationTarget.Global);
  const tp = Date.now();
  await vscode.commands.executeCommand("ghostcode.checkProjectPaths");
  const flagged = vscode.languages.getDiagnostics().flatMap(([uri, ds]) =>
    ds.filter((d) => d.source === "GhostCode").map((d) => `${vscode.workspace.asRelativePath(uri)}:${d.range.start.line + 1} ${d.message}`),
  );
  report("info", `rutas del proyecto (${Date.now() - tp} ms): ${flagged.length} rotas${flagged.length ? "\n" + flagged.map((f) => `     ${f}`).join("\n") : ""}`);
  // Romper rutas en memoria (sin guardar) en un archivo real y corregirlas con la acción rápida.
  const real = await vscode.workspace.openTextDocument(vscode.Uri.file(join(PROJECT, "views/auth/login.php")));
  const ed = await vscode.window.showTextDocument(real);
  const original = real.getText();
  await ed.edit((eb) => {
    const t = real.getText();
    const a = t.indexOf("/../templates/alertas.php");
    eb.replace(new vscode.Range(real.positionAt(a), real.positionAt(a + "/../templates/alertas.php".length)), "/../template/alerta.php");
    const b = t.indexOf('href="/registro"') + 6;
    eb.replace(new vscode.Range(real.positionAt(b), real.positionAt(b + "/registro".length)), "/registr");
  });
  let ds: vscode.Diagnostic[] = [];
  for (let i = 0; i < 20 && ds.length < 2; i++) {
    await sleep(400);
    ds = vscode.languages.getDiagnostics(real.uri).filter((d) => d.source === "GhostCode");
  }
  report(ds.length === 2, `rutas rotas a propósito: ${JSON.stringify(ds.map((d) => d.message))}`);
  for (const d of ds) {
    const acts = await vscode.commands.executeCommand<vscode.CodeAction[]>("vscode.executeCodeActionProvider", real.uri, d.range);
    const fix = acts.find((a) => a.title.includes("corregir ruta") && a.isPreferred);
    if (fix?.edit) await vscode.workspace.applyEdit(fix.edit);
  }
  report(real.getText() === original, `rutas corregidas con la acción rápida: ${real.getText() === original ? "el archivo quedó como el original" : JSON.stringify(real.getText().split("\n").filter((l, i) => l !== original.split("\n")[i]))}`);
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  if (runs("halo")) {
  // --- Halo IA sobre el propio proyecto, con el modelo real ---------------------------------
  const t0 = Date.now();
  await vscode.commands.executeCommand("ghostcode.halo.analyze", PROJECT);
  const h = api().halo.list()[0];
  report(Boolean(h?.summary), `halo (${Date.now() - t0} ms): ${h?.files} archivos, ${h?.functions} funciones · ${h?.styleTags.join(" · ")}\n${(h?.summary ?? "sin resumen").split("\n").map((l) => `     ${l}`).join("\n")}`);
  }
  if (runs("prompt")) {
  // --- Prompt de una selección y PROJECT-CONTEXT.md (escrito fuera del proyecto) ------------
  const editor = await openCopy("models/Usuario.php");
  const doc = editor.document;
  const start = doc.getText().split("\n").findIndex((l) => l.includes("public function validarNuevaCuenta()"));
  let end = start + 1;
  while (doc.lineAt(end).text !== "  }") end++;
  editor.selection = new vscode.Selection(start, 0, end, 3);
  const t0 = Date.now();
  const p = await vscode.commands.executeCommand<{ text: string }>("ghostcode.prompt.fromSelection");
  report(Boolean(p?.text.includes("Código de referencia")), `prompt (${Date.now() - t0} ms):\n${(p?.text ?? "").split("**Código de referencia**")[0].trim().split("\n").map((l) => `     ${l}`).join("\n")}`);
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  const target = vscode.Uri.file(join(WORK, "PROJECT-CONTEXT.md"));
  const t1 = Date.now();
  await vscode.commands.executeCommand("ghostcode.projectContext", target);
  const ctx = new TextDecoder().decode(await vscode.workspace.fs.readFile(target).then((b) => b, () => new Uint8Array()));
  writeFileSync(join(process.env.GHOSTCODE_RESULTS!, "..", "project-context-recordatorios.md"), ctx);
  report(/## De qué trata/.test(ctx) && /## Backend/.test(ctx) && /\| PHP \|/.test(ctx), `PROJECT-CONTEXT.md (${Date.now() - t1} ms, ${ctx.split("\n").length} líneas) → out/project-context-recordatorios.md`);
  }
  if (runs("extensions")) {
  const st = await api().panel.state();
  const recs: { id: string; name: string; because: string; installed: boolean }[] = st.extensions?.recs ?? [];
  report(recs.some((r) => r.id === "xdebug.php-debug"), `extensiones (${st.extensions?.languages.join(", ")}):\n${recs.map((r) => `     ${r.installed ? "✓" : "+"} ${r.name} (${r.id}) — ${r.because}`).join("\n")}`);
  }
  if (runs("indent2")) {
  // --- Corregir indentación con 4 espacios por nivel en un archivo con 2 --------------------
  const editor = await openCopy("src/js/app.js");
  await vscode.commands.executeCommand("ghostcode.fixIndentation", 4);
  const lines = editor.document.getText().split("\n");
  const orig = readFileSync(join(PROJECT, "src/js/app.js"), "utf8").split("\n");
  const sameContent = lines.every((l, i) => l.trim() === (orig[i] ?? "").trim());
  const fn = lines.findIndex((l) => l.startsWith("function mostrarSeccion()"));
  report(sameContent && /^ {4}const seccionAnterior/.test(lines[fn + 2]) && /^ {8}seccionAnterior\.classList/.test(lines[fn + 4]), `indentación con 4 espacios: ${JSON.stringify(lines.slice(fn, fn + 6))}`);
  await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  }
  if (runs("panel")) {
  // --- Panel ---------------------------------------------------------------------
  await vscode.commands.executeCommand("workbench.view.extension.ghostcode");
  await api().panel.refreshModels();
  const st = await api().panel.state();
  report(!st.ollamaError, `panel: Ollama ${st.ollamaError ?? "conectado"}`);
  report(st.installed?.length > 0, `panel: modelos instalados = ${st.installed?.map((m: { name: string }) => m.name).join(", ")}`);
  report(st.suggestions.length >= 3, `panel: ${st.suggestions.length} sugerencias para «${st.hardware}»: ${st.suggestions.map((s: { name: string; installed: boolean }) => `${s.name}${s.installed ? " ✓" : ""}`).join(", ")}`);
  report(Boolean(st.chatAuto), `panel: modelo para anotaciones (auto) = ${st.chatAuto}`);

  }
  writeFileSync(process.env.GHOSTCODE_RESULTS!, out.join("\n") + "\n");
  if (failed) throw new Error("Alguna prueba falló");
}

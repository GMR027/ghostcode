import * as vscode from "vscode";
import { OllamaBackend } from "./backends/ollama";
import { pullModel } from "./commands";
import { cfg, createBackend, update, type Mode } from "./config";
import { annotationRequest, formatAnnotation, resolveAnnotationLanguage } from "./core/annotate";
import { detectIndentUnit, normalizeIndentation, rescaleIndentation, transferIndentation } from "./core/indent";
import { pickChatModel, suggestModels } from "./core/models";
import { commentLines } from "./core/prompt";
import type { Backend, ChatRequest } from "./core/types";
import { getHardware } from "./hardware";

// Lenguajes donde la indentación es sintaxis: reindentar con reglas genéricas los rompería.
const OFFSIDE_LANGS = new Set(["python", "yaml", "coffeescript", "pug", "jade", "haml", "sass", "stylus", "nim", "fsharp", "makefile"]);

/** La selección ampliada a líneas completas (sin la última si acaba en la columna 0). */
function fullLines(doc: vscode.TextDocument, sel: vscode.Selection): vscode.Range {
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  return new vscode.Range(sel.start.line, 0, endLine, doc.lineAt(endLine).text.length);
}

/** Texto del documento tras aplicar `edits`, sin tocar el documento. */
function applyInMemory(doc: vscode.TextDocument, edits: vscode.TextEdit[]): string {
  let text = doc.getText();
  const sorted = [...edits].sort((x, y) => doc.offsetAt(y.range.start) - doc.offsetAt(x.range.start));
  for (const e of sorted) {
    text = text.slice(0, doc.offsetAt(e.range.start)) + e.newText + text.slice(doc.offsetAt(e.range.end));
  }
  return text;
}

/**
 * Corrige la indentación de la selección (o del archivo si no hay selección). Si el
 * lenguaje tiene formateador, se usa solo para saber la sangría correcta de cada línea:
 * no cambia comillas, llaves ni saltos de línea. Si no, se usan las reglas de VS Code.
 */
export async function fixIndentation(spacesArg?: number): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo para corregir su indentación.");
    return;
  }
  const { document: doc, selection } = editor;
  const whole = selection.isEmpty;
  const range = whole ? undefined : fullLines(doc, selection);
  const target = whole ? "el archivo" : "la selección";
  // Espacios por nivel: los indicados (panel o ajuste ghostcode.indentSize) o los del editor.
  const spaces = Number(spacesArg) > 0 ? Number(spacesArg) : cfg().indentSize > 0 ? cfg().indentSize : 0;
  const editorTab = Number(editor.options.tabSize) || 4;
  const options = spaces
    ? { tabSize: spaces, insertSpaces: true }
    : { tabSize: editorTab, insertSpaces: Boolean(editor.options.insertSpaces) };
  if (spaces) editor.options = { ...editor.options, tabSize: spaces, insertSpaces: true };

  // Formatear el documento entero da mejor contexto que formatear solo un rango.
  let edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatDocumentProvider", doc.uri, options);
  if (!edits?.length && range) {
    edits = await vscode.commands.executeCommand<vscode.TextEdit[] | undefined>("vscode.executeFormatRangeProvider", doc.uri, range, options);
  }
  if (edits?.length) {
    const orig = doc.getText().split(/\r?\n/);
    const from = range?.start.line ?? 0;
    const to = range?.end.line ?? orig.length - 1;
    const formatted = applyInMemory(doc, edits).split(/\r?\n/);
    let lines = transferIndentation(orig, formatted, from, to);
    // El formateador puede ignorar el número de espacios pedido (p. ej. Prettier): reescalar.
    if (spaces) lines = rescaleIndentation(lines, detectIndentUnit(formatted, editorTab), spaces, editorTab);
    if (lines.every((l, k) => l === orig[from + k])) {
      vscode.window.setStatusBarMessage(`$(check) GhostCode: ${target} ya estaba bien indentado`, 4000);
      return;
    }
    const we = new vscode.WorkspaceEdit();
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    we.replace(doc.uri, new vscode.Range(from, 0, to, orig[to].length), lines.join(eol));
    await vscode.workspace.applyEdit(we);
    vscode.window.setStatusBarMessage(`$(check) GhostCode: indentación de ${target} corregida`, 4000);
    return;
  }

  const version = doc.version;
  if (OFFSIDE_LANGS.has(doc.languageId)) {
    // Solo unificar tabs/espacios: los bloques no se pueden deducir sin cambiar el significado.
    const orig = doc.getText().split(/\r?\n/);
    const from = range?.start.line ?? 0;
    const to = range?.end.line ?? orig.length - 1;
    let lines = normalizeIndentation(orig.slice(from, to + 1), editorTab, options.insertSpaces);
    // Cambiar los espacios por nivel no altera los bloques (todas las sangrías escalan igual).
    if (spaces) lines = rescaleIndentation(lines, detectIndentUnit(orig, editorTab), spaces, editorTab);
    if (lines.every((l, k) => l === orig[from + k])) {
      void vscode.window.showInformationMessage(
        `GhostCode: la indentación de ${doc.languageId} define los bloques, así que solo se pueden unificar tabs y espacios (ya lo estaban). ` +
          "Para corregirla del todo instala un formateador (p. ej. «Black Formatter» o «autopep8» para Python).",
      );
      return;
    }
    const we = new vscode.WorkspaceEdit();
    const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    we.replace(doc.uri, new vscode.Range(from, 0, to, orig[to].length), lines.join(eol));
    await vscode.workspace.applyEdit(we);
  } else {
    // Sin formateador: reglas de indentación del lenguaje (los comandos de editor necesitan el foco).
    await vscode.window.showTextDocument(doc, { viewColumn: editor.viewColumn, selection: range ?? selection });
    await vscode.commands.executeCommand(whole ? "editor.action.reindentlines" : "editor.action.reindentselectedlines");
  }
  vscode.window.setStatusBarMessage(
    doc.version === version ? `$(check) GhostCode: ${target} ya estaba bien indentado` : `$(check) GhostCode: indentación corregida`,
    4000,
  );
}

/**
 * Backend para herramientas de chat. En local hace falta un modelo instruct: los
 * modelos *base* del autocompletado no siguen instrucciones. Con `interactive` en
 * false (p. ej. desde un hover) no muestra avisos ni ofrece descargas.
 */
export async function chatBackend(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  interactive = true,
): Promise<Backend | undefined> {
  if (mode === "api") return createBackend(secrets, "api");
  const c = cfg();
  let installed: string[];
  try {
    installed = (await OllamaBackend.listModels(c.localUrl)).map((m) => m.name);
  } catch {
    if (interactive) void vscode.window.showErrorMessage(`GhostCode: Ollama no responde en ${c.localUrl}.`);
    return undefined;
  }
  let model = installed.includes(c.localChatModel) ? c.localChatModel : pickChatModel(installed, c.localModel);
  if (!model && !interactive) return undefined;
  if (!model) {
    const suggested = suggestModels(await getHardware()).find((s) => s.use === "chat")!;
    const download = `Descargar ${suggested.name} (${suggested.sizeGb} GB)`;
    const useCurrent = "Usar el modelo actual";
    const choice = await vscode.window.showWarningMessage(
      "GhostCode: para anotar hace falta un modelo que siga instrucciones; los modelos «base» de autocompletado dan malos resultados.",
      download,
      useCurrent,
    );
    if (choice === download) {
      if (!(await pullModel(c.localUrl, suggested.name))) return undefined;
      await update("local.chatModel", suggested.name);
      model = suggested.name;
    } else if (choice === useCurrent) {
      model = c.localModel;
    } else {
      return undefined;
    }
  }
  return new OllamaBackend(c.localUrl, model);
}

/** Inserta encima de la selección un comentario generado por la IA que explica el código. */
export async function annotateSelection(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("GhostCode: selecciona el código que quieres anotar.");
    return;
  }
  const doc = editor.document;
  const range = fullLines(doc, editor.selection);

  let backend: Backend | undefined;
  try {
    backend = await chatBackend(secrets, mode);
  } catch (err) {
    void vscode.window.showErrorMessage(`GhostCode: ${(err as Error).message}`);
    return;
  }
  if (!backend) return;
  const chat = backend;
  const req = annotationRequest(
    doc.getText(range).slice(0, 20_000),
    doc.languageId,
    vscode.workspace.asRelativePath(doc.uri),
    resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env),
  );

  const text = await runChat(chat, req, "anotando", log);
  if (text === undefined) return;
  const lines = formatAnnotation(text);
  if (!lines.length) {
    void vscode.window.showWarningMessage("GhostCode: el modelo no devolvió ninguna anotación.");
    return;
  }

  await insertComment(doc, range.start.line, lines);
}

/**
 * Ejecuta una petición de chat con una notificación de progreso cancelable y un
 * límite de tiempo. Devuelve el texto completo, o undefined si se canceló o falló.
 */
let chatStyle: () => string | undefined = () => undefined;

/** Halo IA registra aquí el estilo del usuario para que lo sigan las herramientas de chat. */
export function setChatStyle(fn: () => string | undefined): void {
  chatStyle = fn;
}

export async function runChat(backend: Backend, req: ChatRequest, what: string, log: vscode.LogOutputChannel): Promise<string | undefined> {
  const style = chatStyle();
  if (style) req = { ...req, system: `${req.system}\n\n${style}` };
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `GhostCode: ${what} con ${backend.label}…`, cancellable: true },
    async (_progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      const timer = setTimeout(() => abort.abort(), 120_000);
      let out = "";
      try {
        for await (const piece of backend.chat(req, abort.signal)) out += piece;
        return out;
      } catch (err) {
        if (token.isCancellationRequested) return undefined;
        const msg = abort.signal.aborted ? "el modelo tardó demasiado en responder." : (err as Error).message;
        log.error(`${what}: ${msg}`);
        void vscode.window.showErrorMessage(`GhostCode: error ${what}: ${msg}`);
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    },
  );
}

/** Inserta `lines` como comentario del lenguaje encima de `line`, con su misma sangría. */
export async function insertComment(doc: vscode.TextDocument, line: number, lines: string[]): Promise<boolean> {
  const indent = /^\s*/.exec(doc.lineAt(line).text)![0];
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const comment = commentLines(doc.languageId, lines.join("\n"))
    .split("\n")
    .map((l) => indent + l + eol)
    .join("");
  const we = new vscode.WorkspaceEdit();
  we.insert(doc.uri, new vscode.Position(line, 0), comment);
  return vscode.workspace.applyEdit(we);
}

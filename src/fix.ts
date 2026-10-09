import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { fixRequest, parseFix, type Problem } from "./core/fix";
import { documentSymbols, enclosingSymbol } from "./symbols";
import { chatBackend, runChat } from "./tools";

const MAX_BLOCK_LINES = 150;
const WINDOW = 25;

/**
 * Bombilla (Ctrl+.) sobre cualquier error o advertencia, venga del lenguaje que venga:
 * «GhostCode: arreglar con IA». También ofrece documentar la función actual.
 */
export class GhostCodeActions implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite];

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const problems = ctx.diagnostics.filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
    for (const d of problems.slice(0, 3)) {
      const short = d.message.split("\n")[0].slice(0, 60);
      const a = new vscode.CodeAction(`GhostCode: arreglar con IA — ${short}`, vscode.CodeActionKind.QuickFix);
      a.diagnostics = [d];
      a.command = { command: "ghostcode.fixWithAI", title: "Arreglar con IA", arguments: [doc.uri, d.range] };
      actions.push(a);
    }
    if (!ctx.only || ctx.only.contains(vscode.CodeActionKind.RefactorRewrite)) {
      const a = new vscode.CodeAction("GhostCode: documentar función", vscode.CodeActionKind.RefactorRewrite);
      a.command = { command: "ghostcode.documentFunction", title: "Documentar función" };
      actions.push(a);
    }
    return actions;
  }
}

/** El problema a arreglar: el indicado o, si no, el más cercano al cursor en el archivo activo. */
function pickProblem(uri?: vscode.Uri, range?: vscode.Range): { uri: vscode.Uri; diag: vscode.Diagnostic } | undefined {
  const editor = vscode.window.activeTextEditor;
  const target = uri ?? editor?.document.uri;
  if (!target) return undefined;
  const diags = vscode.languages.getDiagnostics(target).filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning);
  if (range) {
    const d = diags.find((x) => x.range.isEqual(range)) ?? diags.find((x) => x.range.intersection(range));
    return d ? { uri: target, diag: d } : undefined;
  }
  const line = editor?.selection.active.line ?? 0;
  // Errores antes que advertencias; luego el más cercano al cursor.
  const best = [...diags].sort((a, b) => a.severity - b.severity || Math.abs(a.range.start.line - line) - Math.abs(b.range.start.line - line))[0];
  return best ? { uri: target, diag: best } : undefined;
}

export async function fixWithAI(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  log: vscode.LogOutputChannel,
  uri?: vscode.Uri,
  range?: vscode.Range,
): Promise<void> {
  const picked = pickProblem(uri, range);
  if (!picked) {
    void vscode.window.showInformationMessage("GhostCode: no hay errores ni advertencias en este archivo.");
    return;
  }
  const doc = await vscode.workspace.openTextDocument(picked.uri);
  const at = picked.diag.range.start;

  // Bloque: la función que contiene el error (si no es enorme) o una ventana alrededor.
  const fn = enclosingSymbol(await documentSymbols(doc), at, "function");
  let start = Math.max(0, at.line - WINDOW);
  let end = Math.min(doc.lineCount - 1, at.line + WINDOW);
  if (fn && fn.range.end.line - fn.range.start.line <= MAX_BLOCK_LINES) {
    start = fn.range.start.line;
    end = fn.range.end.line;
  }
  const block = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
  const code = doc.getText(block);
  const isPicked = (d: vscode.Diagnostic) => d.range.isEqual(picked.diag.range) && d.message === picked.diag.message;
  const problems: Problem[] = vscode.languages
    .getDiagnostics(picked.uri)
    .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning && d.range.start.line >= start && d.range.start.line <= end)
    .sort((a, b) => Number(isPicked(b)) - Number(isPicked(a)))
    .slice(0, 8)
    .map((d) => ({
      line: d.range.start.line - start,
      message: d.message,
      severity: d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning",
      source: d.source,
    }));

  const backend = await chatBackend(secrets, mode);
  if (!backend) return;
  const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";
  const raw = await runChat(backend, fixRequest(code, problems, doc.languageId, vscode.workspace.asRelativePath(doc.uri), lang), "buscando un arreglo", log);
  if (raw === undefined) return;
  const fix = parseFix(raw, code);
  if (!fix || fix.code === code.replace(/\s+$/, "")) {
    void vscode.window.showWarningMessage("GhostCode: la IA no encontró un arreglo para este problema.");
    return;
  }
  if (doc.getText(block) !== code) {
    void vscode.window.showWarningMessage("GhostCode: el archivo cambió mientras se buscaba el arreglo; vuelve a intentarlo.");
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  // Con vista previa, VS Code muestra el cambio (Refactor Preview) para aceptarlo o descartarlo.
  edit.replace(doc.uri, block, fix.code, {
    needsConfirmation: cfg().fixPreview,
    label: "Arreglo de GhostCode",
    description: fix.explanation || picked.diag.message,
  });
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied && fix.explanation && !cfg().fixPreview) vscode.window.setStatusBarMessage(`$(check) GhostCode: ${fix.explanation}`, 6000);
}

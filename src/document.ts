import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { resolveAnnotationLanguage } from "./core/annotate";
import { indentOf } from "./core/declarations";
import { annotationsStart, docRequest, existingDoc, parseDocInfo, renderDoc, signatureParams } from "./core/docstyle";
import { documentSymbols, enclosingSymbol, KINDS } from "./symbols";
import { chatBackend, runChat } from "./tools";

/**
 * Genera la documentación (JSDoc, PHPDoc, docstring, `///`…) de la función, método o
 * clase donde está el cursor, en el formato del lenguaje.
 */
export async function documentFunction(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo y coloca el cursor dentro de una función.");
    return;
  }
  const doc = editor.document;
  const symbol = enclosingSymbol(await documentSymbols(doc), editor.selection.active, "function");
  if (!symbol) {
    void vscode.window.showInformationMessage("GhostCode: coloca el cursor dentro de una función, método o clase.");
    return;
  }
  const kind = KINDS.get(symbol.kind) ?? "function";
  const lines = doc.getText().split(/\r?\n/);
  const declLine = symbol.selectionRange.start.line;
  const signature = lines.slice(declLine, declLine + 4).join(" ");
  const isClass = /class|interface|enum|struct/.test(kind);
  const params = isClass ? [] : signatureParams(signature.slice(signature.indexOf(symbol.name)), doc.languageId);

  // Python: el docstring va dentro, tras la línea que cierra la firma con ":".
  let sigEnd = declLine;
  while (sigEnd < Math.min(lines.length - 1, declLine + 10) && !/:\s*(#.*)?$/.test(lines[sigEnd])) sigEnd++;
  const existing = existingDoc(lines, declLine, doc.languageId, sigEnd + 1);
  if (existing) {
    const replace = "Reemplazar";
    const choice = await vscode.window.showWarningMessage(`GhostCode: «${symbol.name}» ya tiene documentación. ¿Reemplazarla?`, replace);
    if (choice !== replace) return;
  }

  const backend = await chatBackend(secrets, mode);
  if (!backend) return;
  const lang = resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env);
  const code = doc.getText(symbol.range).slice(0, 12_000);
  const raw = await runChat(backend, docRequest(code, kind, doc.languageId, vscode.workspace.asRelativePath(doc.uri), lang), `documentando «${symbol.name}»`, log);
  if (raw === undefined) return;
  const info = parseDocInfo(raw, params);
  if (!info.summary) {
    void vscode.window.showWarningMessage("GhostCode: el modelo no devolvió documentación.");
    return;
  }
  const { lines: docLines, inside } = renderDoc(doc.languageId, info, symbol.name, lang);

  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const edit = new vscode.WorkspaceEdit();
  if (inside) {
    // Sangría del cuerpo: la de la primera línea con código tras la firma.
    const body = lines.slice(sigEnd + 1).find((l) => l.trim());
    const indent = body ? body.slice(0, body.length - body.trimStart().length) : " ".repeat(indentOf(lines[declLine]) + 4);
    const text = docLines.map((l) => (l ? indent + l : l)).join(eol) + eol;
    if (existing) edit.replace(doc.uri, new vscode.Range(existing[0], 0, existing[1] + 1, 0), text);
    else edit.insert(doc.uri, new vscode.Position(sigEnd + 1, 0), text);
  } else {
    const at = annotationsStart(lines, declLine);
    const indent = lines[at].slice(0, lines[at].length - lines[at].trimStart().length);
    const text = docLines.map((l) => indent + l).join(eol) + eol;
    if (existing) edit.replace(doc.uri, new vscode.Range(existing[0], 0, existing[1] + 1, 0), text);
    else edit.insert(doc.uri, new vscode.Position(at, 0), text);
  }
  await vscode.workspace.applyEdit(edit);
}

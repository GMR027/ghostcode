import * as vscode from "vscode";
import { verticalizeAttributes } from "./core/attributes";

/** La selección ampliada a líneas completas (sin la última si acaba en la columna 0). */
function fullLines(doc: vscode.TextDocument, sel: vscode.Selection): vscode.Range {
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
  return new vscode.Range(sel.start.line, 0, endLine, doc.lineAt(endLine).text.length);
}

/**
 * Pone cada atributo de las etiquetas en su propia línea, con una sangría más que la
 * etiqueta. Actúa sobre la selección o, si no hay selección, sobre todo el archivo.
 * Solo toca etiquetas con dos o más atributos y que empiezan una línea.
 */
export async function verticalizeTagAttributes(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo para acomodar los atributos de sus etiquetas.");
    return;
  }
  const doc = editor.document;
  const whole = editor.selection.isEmpty;
  const range = whole
    ? new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length)
    : fullLines(doc, editor.selection);
  const target = whole ? "el archivo" : "la selección";

  const tabSize = Number(editor.options.tabSize) || 4;
  const indentUnit = editor.options.insertSpaces === false ? "\t" : " ".repeat(tabSize);
  const eol = doc.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
  const edits = verticalizeAttributes(doc.getText(range), { indentUnit, eol, minAttributes: 2, codeAware: true });

  if (!edits.length) {
    void vscode.window.showInformationMessage(
      `GhostCode: no hay etiquetas con dos o más atributos que acomodar en ${target} (las que ya están en vertical se dejan igual).`,
    );
    return;
  }

  const offset = doc.offsetAt(range.start);
  const we = new vscode.WorkspaceEdit();
  for (const e of edits) {
    const start = doc.positionAt(offset + e.start);
    const end = doc.positionAt(offset + e.end);
    we.replace(doc.uri, new vscode.Range(start, end), e.text);
  }
  if (await vscode.workspace.applyEdit(we)) {
    const n = edits.length;
    vscode.window.setStatusBarMessage(
      `$(check) GhostCode: ${n === 1 ? "1 etiqueta" : `${n} etiquetas`} con los atributos en vertical`,
      5000,
    );
  }
}

import * as vscode from "vscode";
import { adaptSnippet, detectStyle } from "./core/adapt";

/**
 * Adapta el código pegado (o la selección) al estilo del archivo: sangría,
 * comillas, punto y coma y fin de línea. Si no hay selección, toma el
 * portapapeles y lo inserta en el cursor.
 */
export async function adaptPasted(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo para adaptar el código.");
    return;
  }
  const doc = editor.document;
  const sel = editor.selection;
  const fromClipboard = sel.isEmpty;
  let code = fromClipboard ? await vscode.env.clipboard.readText() : doc.getText(sel);
  if (!code.trim()) {
    void vscode.window.showInformationMessage(
      fromClipboard ? "GhostCode: el portapapeles está vacío." : "GhostCode: la selección está vacía.",
    );
    return;
  }
  const line = doc.lineAt(sel.start.line).text;
  const baseIndent = fromClipboard ? /^\s*/.exec(line)![0] : "";
  const rules = detectStyle(doc.getText(), doc.languageId);
  const adapted = adaptSnippet(code, rules, doc.languageId, baseIndent);
  if (adapted.text === code) {
    void vscode.window.showInformationMessage("GhostCode: el código ya sigue el estilo del archivo.");
    return;
  }
  if (fromClipboard) {
    const pick = await vscode.window.showInformationMessage(
      `GhostCode: adaptar ${adapted.changes.length ? adapted.changes.join(", ") : "el código"} al estilo del archivo.`,
      { modal: true },
      "Insertar",
    );
    if (pick !== "Insertar") return;
  }
  const edit = new vscode.WorkspaceEdit();
  if (fromClipboard) edit.insert(doc.uri, sel.start, adapted.text);
  else edit.replace(doc.uri, sel, adapted.text);
  if (await vscode.workspace.applyEdit(edit)) {
    vscode.window.setStatusBarMessage(
      `$(check) GhostCode: código adaptado${adapted.changes.length ? ` · ${adapted.changes.join(", ")}` : ""}`,
      5000,
    );
  }
}

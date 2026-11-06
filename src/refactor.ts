import * as vscode from "vscode";

/**
 * Muestra los refactors que el lenguaje ofrece en la posición del cursor
 * (extraer función/variable, inline, mover…) y aplica el elegido. Usa el
 * proveedor de acciones del propio editor, así funciona en cualquier lenguaje
 * que tenga language server.
 */
export async function refactorAtCursor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo y coloca el cursor en el código a refactorizar.");
    return;
  }
  const doc = editor.document;
  const range = editor.selection.isEmpty
    ? new vscode.Range(editor.selection.active, editor.selection.active)
    : editor.selection;
  let actions: vscode.CodeAction[] | undefined;
  try {
    actions = await vscode.commands.executeCommand<vscode.CodeAction[] | undefined>(
      "vscode.executeCodeActionProvider",
      doc.uri,
      range,
      vscode.CodeActionKind.Refactor,
    );
  } catch {
    actions = undefined;
  }
  const usable = (actions ?? []).filter(
    (a) => a.kind?.contains(vscode.CodeActionKind.Refactor) && (a.edit || a.command),
  );
  if (!usable.length) {
    void vscode.window.showInformationMessage(
      "GhostCode: el lenguaje no ofrece refactors aquí. Prueba a seleccionar una expresión completa o instala el language server del lenguaje.",
    );
    return;
  }
  const picked = await vscode.window.showQuickPick(
    usable.map((a) => ({ label: a.title, description: (a.kind?.value ?? "").replace(/^refactor\.?/, ""), action: a })),
    { title: "GhostCode: refactorizar", placeHolder: "Extraer, mover, inline…" },
  );
  if (!picked) return;
  const action = picked.action;
  try {
    if (action.edit) await vscode.workspace.applyEdit(action.edit);
    if (action.command) await vscode.commands.executeCommand(action.command.command, ...(action.command.arguments ?? []));
  } catch (err) {
    void vscode.window.showErrorMessage(`GhostCode: no se pudo aplicar el refactor: ${(err as Error).message}`);
  }
}

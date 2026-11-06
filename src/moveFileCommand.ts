import * as vscode from "vscode";
import { applyTextEdits, planFileMove } from "./core/moveFile";
import type { WorkspaceFiles } from "./workspaceFiles";

/**
 * Mueve o renombra un archivo y reescribe los imports relativos que lo
 * apuntaban (y los del propio archivo movido). Pide confirmación y muestra
 * cuántas referencias va a tocar.
 */
export async function moveFileCommand(
  files: WorkspaceFiles,
  log: vscode.LogOutputChannel,
  target?: vscode.Uri,
): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage("GhostCode: abre una carpeta para mover archivos.");
    return;
  }
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || !uri.path.startsWith(root.uri.path)) {
    void vscode.window.showInformationMessage("GhostCode: selecciona un archivo del proyecto en el explorador.");
    return;
  }
  const oldPath = vscode.workspace.asRelativePath(uri, false);
  const newPath = await vscode.window.showInputBox({
    title: "GhostCode: mover o renombrar archivo",
    prompt: "Nueva ruta relativa a la carpeta del proyecto",
    value: oldPath,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const v = value.trim().replace(/^\/+/, "");
      if (!v) return "Escribe una ruta.";
      if (v === oldPath) return "La ruta es la misma.";
      if (v.startsWith("../") || v.includes("/../")) return "La ruta debe quedar dentro del proyecto.";
      return undefined;
    },
  });
  if (!newPath) return;
  const dest = newPath.trim().replace(/^\/+/, "");
  const destUri = vscode.Uri.joinPath(root.uri, dest);
  if (await vscode.workspace.fs.stat(destUri).then(() => true, () => false)) {
    void vscode.window.showErrorMessage(`GhostCode: ya existe ${dest}.`);
    return;
  }

  // Leer los archivos del proyecto que pueden contener imports.
  const all = [...(await files.list())];
  const texts: { path: string; text: string }[] = [];
  for (const path of all.slice(0, 2500)) {
    if (!/\.(m?[jt]sx?|cjs|vue|svelte|astro|php|py|rb|go|rs|java|kt|cs|css|scss|sass|less|html?|md)$/i.test(path)) continue;
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(root.uri, path));
      if (stat.size > 300_000) continue;
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, path)));
      texts.push({ path, text });
    } catch {
      // Ignorar.
    }
  }
  const plan = planFileMove(texts, oldPath, dest);
  const answer = await vscode.window.showWarningMessage(
    `Se moverá «${oldPath}» a «${dest}» y se actualizarán ${plan.updated} referencia(s) en ${plan.edits.length} archivo(s).`,
    { modal: true },
    "Mover",
  );
  if (answer !== "Mover") return;

  // Aplicar los imports antes de renombrar: el contenido del archivo movido viaja con él.
  const we = new vscode.WorkspaceEdit();
  for (const file of plan.edits) {
    const fileUri = file.path === oldPath ? uri : vscode.Uri.joinPath(root.uri, file.path);
    for (const edit of file.edits) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      we.replace(fileUri, new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.text);
    }
  }
  if (plan.edits.length && !(await vscode.workspace.applyEdit(we))) {
    void vscode.window.showErrorMessage("GhostCode: no pude actualizar los imports; no se movió el archivo.");
    return;
  }
  try {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(root.uri, dest.split("/").slice(0, -1).join("/")));
    await vscode.workspace.fs.rename(uri, destUri, { overwrite: false });
    log.info(`Archivo movido: ${oldPath} → ${dest} (${plan.updated} imports)`);
    await vscode.window.showTextDocument(destUri);
    vscode.window.setStatusBarMessage(`$(check) GhostCode: ${oldPath} → ${dest}`, 5000);
  } catch (err) {
    void vscode.window.showErrorMessage(`GhostCode: no se pudo mover el archivo: ${(err as Error).message}`);
  }
}

/** Solo para pruebas: aplica el plan a los textos en memoria. */
export function applyPlan(texts: { path: string; text: string }[], plan: ReturnType<typeof planFileMove>): { path: string; text: string }[] {
  return texts.map((file) => {
    const edit = plan.edits.find((e) => e.path === file.path);
    return edit ? { path: file.path, text: applyTextEdits(file.text, edit.edits) } : file;
  });
}

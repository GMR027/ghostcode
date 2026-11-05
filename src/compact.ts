import * as vscode from "vscode";
import { isFolded, nextCompactAction, pickCompactTargets, type BlockRange } from "./core/compact";

/** Rangos plegables que ofrece el lenguaje del documento (HTML, JSX, PHP, JS…). */
async function foldingRanges(doc: vscode.TextDocument): Promise<BlockRange[]> {
  try {
    const ranges = await vscode.commands.executeCommand<vscode.FoldingRange[] | undefined>(
      "vscode.executeFoldingRangeProvider",
      doc.uri,
    );
    return (ranges ?? [])
      .map((r) => ({ start: r.start, end: r.end }))
      .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start);
  } catch {
    return [];
  }
}

/**
 * Compacta o expande el bloque de la función o etiqueta más cercano al cursor
 * (o el que contiene la selección). No modifica el texto: usa el plegado nativo
 * del editor, así que se puede volver a expandir cuando quieras.
 */
export async function toggleCompact(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo para compactar una función o una etiqueta.");
    return;
  }

  const doc = editor.document;
  const selections = editor.selections.map((s) => ({ start: s.start.line, end: s.end.line }));
  const targets = pickCompactTargets(await foldingRanges(doc), selections);

  if (!targets.length) {
    // Algunos lenguajes pliegan por indentación sin proveedor de rangos.
    await vscode.commands.executeCommand("editor.toggleFold");
    return;
  }

  const visible = editor.visibleRanges.map((r) => ({ start: r.start.line, end: r.end.line }));
  const action = nextCompactAction(targets.map((t) => isFolded(t, visible)));
  const lines = [...new Set(targets.map((t) => t.start))];
  await vscode.commands.executeCommand(action === "fold" ? "editor.fold" : "editor.unfold", {
    levels: 1,
    selectionLines: lines,
  });

  const n = lines.length;
  const what = n === 1 ? "1 bloque" : `${n} bloques`;
  const done = action === "fold" ? (n === 1 ? "compactado" : "compactados") : n === 1 ? "expandido" : "expandidos";
  vscode.window.setStatusBarMessage(`$(check) GhostCode: ${what} ${done}`, 4000);
}

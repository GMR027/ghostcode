import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { detectConvention, parseRenameSuggestions, renameRequest, type Convention, type NameSuggestion } from "./core/naming";
import type { ProjectIndex } from "./projectIndex";
import { documentSymbols, enclosingSymbol, findDefinition, flattenSymbols, KINDS } from "./symbols";
import { chatBackend, runChat } from "./tools";

// Convención habitual de cada lenguaje, si el archivo no tiene suficientes funciones para deducirla.
const DEFAULT_CONVENTION: Record<string, Convention> = {
  python: "snake", ruby: "snake", rust: "snake", elixir: "snake", php: "camel", go: "camel", csharp: "pascal",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sugiere nombres para la función seleccionada (o la que contiene el cursor) según lo
 * que hace, y la renombra en todo el proyecto.
 */
export async function renameWithAI(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  log: vscode.LogOutputChannel,
  project: ProjectIndex,
  /**
   * Para automatizar (pruebas): `pick` usa esa sugerencia sin preguntar; `dryRun` solo
   * devuelve las sugerencias.
   */
  opts: { pick?: number; dryRun?: boolean } = {},
): Promise<NameSuggestion[] | void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: selecciona el nombre de una función (o coloca el cursor dentro).");
    return;
  }
  const doc = editor.document;
  const sel = editor.selection;
  const symbols = await documentSymbols(doc);

  // Qué renombrar: el nombre seleccionado (declaración o uso) o la función donde está el cursor.
  let target: { doc: vscode.TextDocument; symbol: vscode.DocumentSymbol } | undefined;
  let renameAt: { uri: vscode.Uri; pos: vscode.Position } | undefined;
  const word = sel.isEmpty ? undefined : doc.getText(sel).trim();
  if (word && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(word)) {
    target = await findDefinition(doc, sel.start, word, project);
    renameAt = { uri: doc.uri, pos: sel.start };
  }
  if (!target) {
    const symbol = enclosingSymbol(symbols, sel.active, "function");
    if (symbol) target = { doc, symbol };
  }
  if (!target) {
    void vscode.window.showInformationMessage("GhostCode: selecciona el nombre de una función, método o clase.");
    return;
  }
  const { symbol } = target;
  renameAt ??= { uri: target.doc.uri, pos: symbol.selectionRange.start };
  const kind = KINDS.get(symbol.kind) ?? "function";

  const names = flattenSymbols(await documentSymbols(target.doc))
    .filter((s) => KINDS.has(s.kind) && !/class|interface|enum|struct/.test(KINDS.get(s.kind)!))
    .map((s) => s.name);
  const conv = /class|interface|enum|struct/.test(kind) ? "pascal" : detectConvention(names, DEFAULT_CONVENTION[target.doc.languageId] ?? "camel");

  const backend = await chatBackend(secrets, mode);
  if (!backend) return;
  const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";
  const code = target.doc.getText(symbol.range).slice(0, 10_000);
  const raw = await runChat(backend, renameRequest(code, symbol.name, kind, target.doc.languageId, lang), `buscando nombres para «${symbol.name}»`, log);
  if (raw === undefined) return;
  const suggestions = parseRenameSuggestions(raw, symbol.name, conv);

  if (opts.dryRun) return suggestions;
  if (opts.pick !== undefined && suggestions[opts.pick]) return applyRename(symbol.name, suggestions[opts.pick].name, renameAt, target.doc, doc, project, log);
  const other = "$(edit) Escribir otro nombre…";
  const pick = await vscode.window.showQuickPick(
    [...suggestions.map((s) => ({ label: s.name, detail: s.reason })), { label: other, detail: "" }],
    { title: `GhostCode — renombrar «${symbol.name}»`, placeHolder: suggestions.length ? "Elige un nombre" : "El modelo no sugirió nombres válidos" },
  );
  if (!pick) return;
  const newName =
    pick.label === other
      ? await vscode.window.showInputBox({ title: `Nuevo nombre para «${symbol.name}»`, value: suggestions[0]?.name ?? symbol.name })
      : pick.label;
  if (!newName || newName === symbol.name) return;
  await applyRename(symbol.name, newName, renameAt, target.doc, doc, project, log);
}

async function applyRename(
  oldName: string,
  newName: string,
  renameAt: { uri: vscode.Uri; pos: vscode.Position },
  defDoc: vscode.TextDocument,
  doc: vscode.TextDocument,
  project: ProjectIndex,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const symbol = { name: oldName };
  const target = { doc: defDoc };
  // 1. El renombrado del propio lenguaje (actualiza todas las referencias con precisión).
  let edit: vscode.WorkspaceEdit | undefined;
  try {
    edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>("vscode.executeDocumentRenameProvider", renameAt.uri, renameAt.pos, newName);
  } catch (err) {
    log.info(`Renombrar: el lenguaje no lo soporta (${(err as Error).message}); se buscará el nombre en el proyecto.`);
  }
  if (edit && edit.size > 0) {
    await vscode.workspace.applyEdit(edit);
    vscode.window.setStatusBarMessage(`$(check) GhostCode: «${symbol.name}» → «${newName}»`, 5000);
    return;
  }

  // 2. Sin soporte del lenguaje: buscar el nombre como palabra en el proyecto y mostrar la vista previa.
  const fallback = new vscode.WorkspaceEdit();
  const re = new RegExp(`(?<![\\p{L}\\p{N}_$])${escapeRe(symbol.name)}(?![\\p{L}\\p{N}_$])`, "gu");
  const uris = new Map<string, vscode.Uri>([[target.doc.uri.toString(), target.doc.uri], [doc.uri.toString(), doc.uri]]);
  for (const u of project.sameFamily(target.doc.uri)) uris.set(u.toString(), u);
  let count = 0;
  for (const uri of uris.values()) {
    const d = await vscode.workspace.openTextDocument(uri);
    const text = d.getText();
    for (const m of text.matchAll(re)) {
      const start = d.positionAt(m.index!);
      fallback.replace(uri, new vscode.Range(start, d.positionAt(m.index! + m[0].length)), newName, {
        needsConfirmation: true,
        label: `Renombrar «${symbol.name}» → «${newName}»`,
      });
      count++;
    }
  }
  if (!count) return;
  void vscode.window.showInformationMessage(
    `GhostCode: este lenguaje no tiene renombrado propio; revisa las ${count} coincidencias en la vista previa antes de aplicarlas.`,
  );
  await vscode.workspace.applyEdit(fallback);
}

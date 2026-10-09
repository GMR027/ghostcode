import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { codePromptRequest, finishCodePrompt, gatherFacts, projectContextDoc, projectContextRequest, promptEntry, PROMPTS_HEADER } from "./core/prompts";
import type { ProjectIndex } from "./projectIndex";
import { projectStack } from "./stack";
import { chatBackend, runChat } from "./tools";
import type { WorkspaceFiles } from "./workspaceFiles";

const language = () => LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";

/** Último prompt generado (lo muestra el panel para copiarlo o guardarlo). */
export interface GeneratedPrompt {
  text: string;
  source: string;
}

/** Prompt reutilizable a partir del código seleccionado. */
export async function promptFromSelection(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<GeneratedPrompt | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage("GhostCode: selecciona el código del que quieres crear un prompt.");
    return undefined;
  }
  const doc = editor.document;
  const sel = editor.selection;
  const code = doc.getText(new vscode.Range(sel.start.line, 0, sel.end.line, doc.lineAt(sel.end.line).text.length)).slice(0, 15_000);
  const backend = await chatBackend(secrets, mode);
  if (!backend) return undefined;
  const raw = await runChat(backend, codePromptRequest(code, doc.languageId, vscode.workspace.asRelativePath(doc.uri), language()), "creando el prompt", log);
  if (raw === undefined) return undefined;
  const source = `${vscode.workspace.asRelativePath(doc.uri)}:${sel.start.line + 1}-${sel.end.line + 1}`;
  return { text: finishCodePrompt(raw, code, doc.languageId), source };
}

export async function copyPrompt(text: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage("$(check) GhostCode: prompt copiado al portapapeles", 4000);
}

function workspaceFile(name: string): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder && vscode.Uri.joinPath(folder.uri, name);
}

/** Añade el prompt a PROMPTS.md (lo crea si no existe) y lo abre. */
export async function savePrompt(p: GeneratedPrompt): Promise<void> {
  const uri = workspaceFile(cfg().promptsFile);
  if (!uri) {
    void vscode.window.showInformationMessage("GhostCode: abre una carpeta de proyecto para guardar los prompts.");
    return;
  }
  let current = "";
  try {
    current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    current = PROMPTS_HEADER;
  }
  const text = current.replace(/\s*$/, "\n\n") + promptEntry(p.text, p.source, new Date());
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  editor.revealRange(new vscode.Range(doc.lineCount - 1, 0, doc.lineCount - 1, 0));
  vscode.window.setStatusBarMessage(`$(check) GhostCode: prompt guardado en ${cfg().promptsFile}`, 4000);
}

/** PROJECT-CONTEXT.md: de qué trata el proyecto, objetivo, lenguajes, estructura, frontend y backend. */
export async function createProjectContext(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  log: vscode.LogOutputChannel,
  files: WorkspaceFiles,
  project: ProjectIndex,
  hasGit: boolean,
  /** Dónde escribirlo (por defecto PROJECT-CONTEXT.md en la raíz del proyecto). */
  target?: vscode.Uri,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const uri = target ?? workspaceFile("PROJECT-CONTEXT.md");
  if (!folder || !uri) {
    void vscode.window.showInformationMessage("GhostCode: abre la carpeta del proyecto primero.");
    return;
  }
  const exists = await vscode.workspace.fs.stat(uri).then(() => true, () => false);
  if (exists) {
    const replace = "Reemplazar";
    if ((await vscode.window.showWarningMessage("GhostCode: PROJECT-CONTEXT.md ya existe. ¿Reemplazarlo?", replace)) !== replace) return;
  }
  const backend = await chatBackend(secrets, mode);
  if (!backend) return;
  const { stack, manifests } = await projectStack(files, project, hasGit);
  const list = [...(await files.list())];
  const readmePath = list.find((f) => /^readme(\.\w+)?$/i.test(f));
  const readme = readmePath ? new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, readmePath))) : undefined;
  const facts = gatherFacts(folder.name, list, manifests, stack, project.routes(), readme);
  const narrative = await runChat(backend, projectContextRequest(facts, project.outlines(), language()), "analizando el proyecto", log);
  if (narrative === undefined) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(projectContextDoc(facts, narrative, new Date())));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: false });
  vscode.window.setStatusBarMessage("$(check) GhostCode: PROJECT-CONTEXT.md creado", 5000);
}

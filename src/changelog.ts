import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { buildChangelog, gitLogArgs, mergeChangelog, parseGitLog } from "./core/changelog";

const run = promisify(execFile);

/**
 * Genera el CHANGELOG a partir de los commits desde la última etiqueta y ofrece
 * guardarlo en CHANGELOG.md. No usa IA.
 */
export async function generateChangelog(log: vscode.LogOutputChannel): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showInformationMessage("GhostCode: abre una carpeta con Git para generar el CHANGELOG.");
    return;
  }
  const cwd = root.uri.fsPath;
  let lastTag: string | undefined;
  try {
    lastTag = (await run("git", ["describe", "--tags", "--abbrev=0"], { cwd, timeout: 5000 })).stdout.trim() || undefined;
  } catch {
    lastTag = undefined;
  }
  let raw = "";
  try {
    raw = (await run("git", gitLogArgs(lastTag ? `${lastTag}..HEAD` : undefined), { cwd, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })).stdout;
  } catch (err) {
    void vscode.window.showErrorMessage(`GhostCode: no pude leer el historial de Git: ${(err as Error).message}`);
    return;
  }
  const commits = parseGitLog(raw);
  if (!commits.length) {
    void vscode.window.showInformationMessage(
      lastTag ? `GhostCode: no hay commits nuevos desde la etiqueta ${lastTag}.` : "GhostCode: el repositorio todavía no tiene commits.",
    );
    return;
  }
  const section = buildChangelog(commits, { version: lastTag ? `Después de ${lastTag}` : undefined });
  const existing = await readFile(root.uri, "CHANGELOG.md");
  const next = mergeChangelog(existing, section);
  const doc = await vscode.workspace.openTextDocument({ content: next, language: "markdown" });
  await vscode.window.showTextDocument(doc, { preview: true });
  const choice = await vscode.window.showInformationMessage(
    `GhostCode: ${commits.length} commit(s) agrupados. ${lastTag ? `Desde ${lastTag}.` : "Sin etiquetas previas."}`,
    "Guardar en CHANGELOG.md",
    "Copiar",
  );
  if (choice === "Guardar en CHANGELOG.md") {
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root.uri, "CHANGELOG.md"), new TextEncoder().encode(next));
    const saved = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(root.uri, "CHANGELOG.md"));
    await vscode.window.showTextDocument(saved);
    log.info("CHANGELOG.md actualizado");
  } else if (choice === "Copiar") {
    await vscode.env.clipboard.writeText(section);
  }
}

async function readFile(root: vscode.Uri, name: string): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name)));
  } catch {
    return undefined;
  }
}

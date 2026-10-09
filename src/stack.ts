import * as vscode from "vscode";
import { detectStack, recommend, type Recommendation, type Stack } from "./core/extensions";
import type { ProjectIndex } from "./projectIndex";
import type { WorkspaceFiles } from "./workspaceFiles";

const MANIFESTS = /(^|\/)(package\.json|composer\.json|requirements(-dev)?\.txt|pyproject\.toml|Pipfile|Gemfile|go\.mod|Cargo\.toml|pubspec\.yaml)$/;

/** Contenido de los manifiestos (package.json, composer.json…) de la raíz y un nivel por debajo. */
export async function readManifests(files: Iterable<string>): Promise<Record<string, string>> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const out: Record<string, string> = {};
  if (!folder) return out;
  for (const f of files) {
    if (!MANIFESTS.test(f) || f.split("/").length > 2 || /node_modules|vendor/.test(f)) continue;
    try {
      out[f] = new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, f)));
    } catch {
      // ilegible: ignorar
    }
  }
  return out;
}

export async function projectStack(files: WorkspaceFiles, project: ProjectIndex, hasGit: boolean): Promise<{ stack: Stack; manifests: Record<string, string> }> {
  const list = await files.list();
  await project.ensure();
  const manifests = await readManifests(list);
  return { stack: detectStack([...list], manifests, project.usesSql, hasGit), manifests };
}

const installed = (id: string) => vscode.extensions.all.some((e) => e.id.toLowerCase() === id.toLowerCase());

export async function extensionRecommendations(files: WorkspaceFiles, project: ProjectIndex, hasGit: boolean): Promise<{ recs: Recommendation[]; languages: string[] }> {
  if (!vscode.workspace.workspaceFolders?.length) return { recs: [], languages: [] };
  const { stack } = await projectStack(files, project, hasGit);
  return { recs: recommend(stack, installed), languages: stack.languages.slice(0, 6).map((l) => `${l.label} (${l.files})`) };
}

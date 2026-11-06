import * as vscode from "vscode";
import {
  detectTestFramework,
  findTestFile,
  untestedSymbols,
  type TestFramework,
  type UntestedSymbol,
} from "./core/tests";
import type { WorkspaceFiles } from "./workspaceFiles";

export interface TestState {
  file?: string;
  testFile?: string;
  framework?: string;
  command?: string;
  missing: UntestedSymbol[];
  error?: string;
}

/**
 * Relaciona el archivo abierto con su test, detecta el framework y prepara el
 * comando para ejecutarlo. El comando se lanza en una terminal del editor.
 */
export class TestExplorer {
  private cache?: { key: string; state: TestState };

  constructor(private readonly files: WorkspaceFiles) {}

  async state(): Promise<TestState> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return { missing: [] };
    const doc = editor.document;
    if (!/\.(m?[jt]sx?|cjs|vue|svelte|astro|php|py|rb|go|rs|java|kt|cs)$/i.test(doc.uri.path)) return { missing: [] };
    const rel = vscode.workspace.asRelativePath(doc.uri, false);
    const key = `${doc.uri.toString()}:${doc.version}:${(await this.files.list()).size}`;
    if (this.cache?.key === key) return this.cache.state;

    try {
      const list = await this.files.list();
      const root = vscode.workspace.workspaceFolders?.[0];
      const read = async (name: string) => {
        if (!root || !list.has(name)) return undefined;
        try {
          return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, name)));
        } catch {
          return undefined;
        }
      };
      const [packageJson, composerJson] = await Promise.all([read("package.json"), read("composer.json")]);
      const framework = detectTestFramework(list, packageJson, composerJson);
      const testFile = findTestFile(rel, list);
      const testText = testFile ? await read(testFile) : undefined;
      const state: TestState = {
        file: rel,
        testFile,
        framework: framework?.label,
        command: framework?.command(testFile ?? rel),
        missing: untestedSymbols(doc.getText(), testText),
      };
      this.cache = { key, state };
      return state;
    } catch (err) {
      return { file: rel, missing: [], error: (err as Error).message };
    }
  }

  async openTest(): Promise<void> {
    const state = await this.state();
    if (!state.testFile) {
      void vscode.window.showInformationMessage(
        `GhostCode: no encontré un test para ${state.file ?? "este archivo"}. Se busca por las convenciones de tu framework (${state.framework ?? "sin detectar"}).`,
      );
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) return;
    await vscode.window.showTextDocument(vscode.Uri.joinPath(root.uri, state.testFile));
  }

  async runTest(): Promise<void> {
    const state = await this.state();
    if (!state.command) {
      void vscode.window.showInformationMessage("GhostCode: no reconocí el framework de tests de este proyecto.");
      return;
    }
    const terminal = vscode.window.createTerminal({ name: "GhostCode · tests" });
    terminal.show();
    terminal.sendText(state.command, true);
  }
}

import * as vscode from "vscode";
import { OllamaBackend } from "./backends/ollama";
import {
  clearApiKeyCommand, configureApi, selectLocalModel, selectMode, setApiKeyCommand, toggleLanguage,
} from "./commands";
import { cfg, createBackend, update } from "./config";
import type { Backend } from "./core/types";
import { documentFunction } from "./document";
import { askAssistant } from "./assistant";
import { fixWithAI, GhostCodeActions } from "./fix";
import { generateCommitMessage, GitInfo } from "./git";
import { ExplainHoverProvider, type ExplanationRef } from "./hover";
import { HaloService } from "./halo";
import { GhostCodePanel } from "./panel";
import { PathChecker } from "./pathCheck";
import { copyPrompt, createProjectContext, promptFromSelection, savePrompt } from "./promptTools";
import { renameWithAI } from "./rename";
import { WorkspaceFiles } from "./workspaceFiles";
import { ProjectIndex } from "./projectIndex";
import { GhostCodeProvider } from "./provider";
import { StatusBar } from "./statusBar";
import { annotateSelection, fixIndentation, insertComment, setChatStyle } from "./tools";

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("GhostCode", { log: true });
  const status = new StatusBar();
  let backend: Backend | undefined;
  let lastMode: "local" | "api" = cfg().mode === "off" ? "local" : (cfg().mode as "local" | "api");

  // Las herramientas funcionan aunque el autocompletado esté desactivado.
  const toolMode = () => (cfg().mode === "off" ? lastMode : (cfg().mode as "local" | "api"));
  const project = new ProjectIndex(log);
  const files = new WorkspaceFiles();
  const halo = new HaloService(context.globalStorageUri.fsPath, context.secrets, toolMode, log);
  void halo.restore();
  setChatStyle(() => halo.chatContext());
  const provider = new GhostCodeProvider(() => backend, status, log, project, halo);
  const git = new GitInfo();
  const paths = new PathChecker(files, project);
  const panel = new GhostCodePanel(context, () => backend?.label, () => lastMode, { git, project, halo, paths, files });
  const hover = new ExplainHoverProvider(context.secrets, toolMode, log, project);
  const hasGit = async () => (await git.status()).status === "repo";

  // (Re)crea el backend cuando cambia el modo, el modelo o la API key: sin recargar VS Code.
  const reload = async () => {
    try {
      backend = await createBackend(context.secrets);
      status.setBackend(backend?.label);
      log.info(`Modo: ${cfg().mode} → ${backend?.label ?? "desactivado"}`);
      if (backend instanceof OllamaBackend) void backend.warmUp();
    } catch (err) {
      backend = undefined;
      status.setBackend(undefined);
      status.error((err as Error).message);
      log.error((err as Error).message);
    }
    provider.clearCache();
    hover.clearCache();
    const mode = cfg().mode;
    if (mode !== "off") lastMode = mode;
    panel.refresh();
  };

  context.subscriptions.push(
    log,
    status,
    project,
    files,
    halo,
    paths,
    git,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider),
    vscode.window.registerWebviewViewProvider(GhostCodePanel.viewId, panel),
    vscode.languages.registerHoverProvider({ pattern: "**" }, hover),
    vscode.languages.registerCodeActionsProvider({ pattern: "**" }, paths, { providedCodeActionKinds: PathChecker.kinds }),
    vscode.languages.registerCodeActionsProvider({ pattern: "**" }, new GhostCodeActions(), {
      providedCodeActionKinds: GhostCodeActions.kinds,
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ghostcode")) void reload();
    }),
    context.secrets.onDidChange((e) => {
      if (e.key.startsWith("ghostcode.")) void reload();
    }),
    vscode.commands.registerCommand("ghostcode.selectMode", () => selectMode(context.secrets)),
    vscode.commands.registerCommand("ghostcode.selectLocalModel", async () => {
      if (await selectLocalModel()) await update("mode", "local");
    }),
    vscode.commands.registerCommand("ghostcode.configureApi", async () => {
      if (await configureApi(context.secrets)) await update("mode", "api");
    }),
    vscode.commands.registerCommand("ghostcode.setApiKey", () => setApiKeyCommand(context.secrets)),
    vscode.commands.registerCommand("ghostcode.clearApiKey", () => clearApiKeyCommand(context.secrets)),
    vscode.commands.registerCommand("ghostcode.toggle", () => update("mode", cfg().mode === "off" ? lastMode : "off")),
    vscode.commands.registerCommand("ghostcode.toggleLanguage", toggleLanguage),
    vscode.commands.registerCommand("ghostcode.trigger", () =>
      vscode.commands.executeCommand("editor.action.inlineSuggest.trigger"),
    ),
    vscode.commands.registerCommand("ghostcode.showLog", () => log.show()),
    vscode.commands.registerCommand("ghostcode.fixIndentation", (spaces?: number) => fixIndentation(spaces)),
    vscode.commands.registerCommand("ghostcode.rename", (opts?: { pick?: number; dryRun?: boolean }) => renameWithAI(context.secrets, toolMode(), log, project, opts)),
    vscode.commands.registerCommand("ghostcode.checkPaths", () => paths.fixAtCursor()),
    vscode.commands.registerCommand("ghostcode.checkProjectPaths", () => paths.checkProject()),
    vscode.commands.registerCommand("ghostcode.halo.analyze", async (input?: string) => {
      const value =
        input ??
        (await vscode.window.showInputBox({
          title: "Halo IA",
          prompt: "Ruta de una carpeta de proyecto o URL de un repositorio",
          placeHolder: "~/proyectos/mi-app  ·  https://github.com/usuario/repo",
          ignoreFocusOut: true,
        }));
      if (value) return halo.analyze(value);
    }),
    vscode.commands.registerCommand("ghostcode.prompt.fromSelection", async () => {
      const p = await promptFromSelection(context.secrets, toolMode(), log);
      if (p) {
        panel.setPrompt(p);
        await vscode.commands.executeCommand("workbench.view.extension.ghostcode");
      }
      return p;
    }),
    vscode.commands.registerCommand("ghostcode.prompt.copy", (text?: string) => {
      const t = text ?? panel.prompt?.text;
      if (t) return copyPrompt(t);
    }),
    vscode.commands.registerCommand("ghostcode.prompt.save", (text?: string) => {
      const p = panel.prompt;
      if (p || text) return savePrompt({ text: text ?? p!.text, source: p?.source ?? "?" });
    }),
    vscode.commands.registerCommand("ghostcode.projectContext", async (target?: vscode.Uri) =>
      createProjectContext(context.secrets, toolMode(), log, files, project, await hasGit(), target),
    ),
    vscode.commands.registerCommand("ghostcode.goToSymbol", async (ref: { uri: string; line: number; character: number }) => {
      const pos = new vscode.Position(ref.line, ref.character);
      await vscode.window.showTextDocument(vscode.Uri.parse(ref.uri), { selection: new vscode.Range(pos, pos) });
      await vscode.commands.executeCommand("revealLine", { lineNumber: ref.line, at: "center" });
    }),
    vscode.commands.registerCommand("ghostcode.assistant.ask", (code: string) => askAssistant(context.secrets, toolMode(), log, code)),
    vscode.commands.registerCommand("ghostcode.annotate", () => annotateSelection(context.secrets, toolMode(), log)),
    vscode.commands.registerCommand("ghostcode.documentFunction", () => documentFunction(context.secrets, toolMode(), log)),
    vscode.commands.registerCommand("ghostcode.fixWithAI", (uri?: vscode.Uri, range?: vscode.Range) =>
      fixWithAI(context.secrets, toolMode(), log, uri, range),
    ),
    vscode.commands.registerCommand("ghostcode.commitMessage", () => generateCommitMessage(git, context.secrets, toolMode(), log)),
    vscode.commands.registerCommand("ghostcode.toggleHover", () => update("hoverExplain", !cfg().hoverExplain)),
    vscode.commands.registerCommand("ghostcode.insertExplanation", async (ref: ExplanationRef) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(ref.uri));
      await insertComment(doc, ref.line, ref.lines);
    }),
    vscode.commands.registerCommand("ghostcode.refreshPanel", () => panel.refreshModels()),
  );

  const ready = reload();
  // API mínima para las pruebas de integración.
  return { provider, ready, panel, project, git, halo, paths, files };
}

export function deactivate(): void {}

import * as vscode from "vscode";
import { OllamaBackend } from "./backends/ollama";
import { enableApiMode, pullModel } from "./commands";
import { cfg, defaultApiModel, PROVIDER_LABELS, update } from "./config";
import { describeHardware, isCompletionOnly, pickChatModel, suggestModels } from "./core/models";
import type { GitInfo } from "./git";
import type { HaloService } from "./halo";
import { getHardware } from "./hardware";
import type { PathChecker } from "./pathCheck";
import type { ProjectIndex } from "./projectIndex";
import type { GeneratedPrompt } from "./promptTools";
import { extensionRecommendations } from "./stack";
import type { WorkspaceFiles } from "./workspaceFiles";

export interface PanelServices {
  git: GitInfo;
  project: ProjectIndex;
  halo: HaloService;
  paths: PathChecker;
  files: WorkspaceFiles;
}

/** Mensajes que envía la vista (media/panel.js). */
type Msg =
  | {
      type:
        | "ready" | "refresh" | "toggle" | "toggleHover" | "toggleProjectContext" | "togglePathCheck" | "toggleHalo"
        | "configureApi" | "annotate" | "document" | "fix" | "rename" | "checkPaths" | "checkProjectPaths"
        | "commit" | "gitInit" | "publish" | "openRemote" | "openScm" | "settings"
        | "haloBrowse" | "haloWorkspace" | "haloSave" | "haloClear" | "prompt" | "projectContext" | "refreshExtensions";
    }
  | { type: "indent"; spaces?: string }
  | { type: "indentSize"; value: string }
  | { type: "haloAnalyze"; value: string }
  | { type: "haloRemove"; id: string }
  | { type: "copyPrompt" | "savePrompt"; value: string }
  | { type: "installExt" | "showExt"; id: string }
  | { type: "showBroken" | "hideBroken" }
  | { type: "openBroken" | "fixBroken"; uri: string; line: string; start: string; end: string; value?: string }
  | { type: "openUrl"; url: string }
  | { type: "mode"; mode: "local" | "api" }
  | { type: "useModel"; name: string }
  | { type: "useChatModel"; name: string }
  | { type: "pull"; name: string };

/** Vista lateral de GhostCode: activar, modelo local, modelos sugeridos y herramientas. */
export class GhostCodePanel implements vscode.WebviewViewProvider {
  static readonly viewId = "ghostcode.panel";

  private view?: vscode.WebviewView;
  private installed?: { name: string; sizeGb: number }[];
  private ollamaError?: string;
  /** Descargas en curso: modelo → porcentaje. */
  private readonly pulling = new Map<string, number>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getBackendLabel: () => string | undefined,
    private readonly getLastMode: () => "local" | "api",
    private readonly services: PanelServices,
  ) {
    // Cambios en git, el índice, Halo IA o las rutas: refrescar (agrupando ráfagas de eventos).
    let timer: NodeJS.Timeout | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.post(), 300);
    };
    const { git, project, halo, paths } = services;
    context.subscriptions.push(
      git.onDidChange(soon),
      project.onDidChange(soon),
      halo.onDidChange(soon),
      paths.onDidChange(soon),
      // Al instalar/desinstalar extensiones cambia la lista de recomendaciones.
      vscode.extensions.onDidChange(() => {
        this.recommendations = undefined;
        soon();
      }),
    );
  }

  private get git(): GitInfo {
    return this.services.git;
  }

  private get project(): ProjectIndex {
    return this.services.project;
  }

  /** Último prompt generado con «Prompt». */
  prompt?: GeneratedPrompt;
  private promptBusy = false;
  /** «Mostrar rutas rotas»: la lista está desplegada en el panel. */
  private brokenShown = false;
  private brokenBusy = false;
  private recommendations?: Awaited<ReturnType<typeof extensionRecommendations>>;

  setPrompt(p: GeneratedPrompt): void {
    this.prompt = p;
    void this.post();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((m: Msg) => void this.handle(m));
    // Al volver a mostrarse, los modelos instalados pueden haber cambiado (ollama pull/rm).
    view.onDidChangeVisibility(() => view.visible && void this.refreshModels());
    view.onDidDispose(() => (this.view = undefined));
  }

  /** Vuelve a enviar el estado (cambió la configuración o el backend). */
  refresh(): void {
    void this.post();
  }

  async refreshModels(): Promise<void> {
    try {
      const models = await OllamaBackend.listModels(cfg().localUrl);
      this.installed = models.map((m) => ({ name: m.name, sizeGb: Math.round(m.size / 1e8) / 10 }));
      this.ollamaError = undefined;
    } catch {
      this.installed = undefined;
      this.ollamaError = `Ollama no responde en ${cfg().localUrl}`;
    }
    await this.post();
  }

  private async handle(m: Msg): Promise<void> {
    const c = cfg();
    switch (m.type) {
      case "ready":
      case "refresh":
        return this.refreshModels();
      case "toggle":
        return void vscode.commands.executeCommand("ghostcode.toggle");
      case "toggleHover":
        return update("hoverExplain", !c.hoverExplain);
      case "toggleProjectContext":
        return update("projectContext", !c.projectContext);
      case "togglePathCheck":
        return update("pathCheck", !c.pathCheck);
      case "toggleHalo":
        return update("halo.enabled", !c.haloEnabled);
      case "indent":
        return void vscode.commands.executeCommand("ghostcode.fixIndentation", Number(m.spaces) || 0);
      case "indentSize":
        return update("indentSize", Math.max(0, Math.min(16, Number(m.value) || 0)));
      case "rename":
        return void vscode.commands.executeCommand("ghostcode.rename");
      case "checkPaths":
        return void vscode.commands.executeCommand("ghostcode.checkPaths");
      case "checkProjectPaths":
        return void vscode.commands.executeCommand("ghostcode.checkProjectPaths");
      case "haloAnalyze":
        await this.services.halo.analyze(m.value);
        return;
      case "haloBrowse": {
        const picked = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, title: "Halo IA — carpeta del proyecto a analizar" });
        if (picked?.[0]) await this.services.halo.analyze(picked[0].fsPath);
        return;
      }
      case "haloWorkspace": {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (folder) await this.services.halo.analyze(folder.uri.fsPath);
        else void vscode.window.showInformationMessage("GhostCode: no hay ninguna carpeta abierta.");
        return;
      }
      case "haloSave":
        return this.services.halo.save();
      case "haloClear":
        return this.services.halo.clear();
      case "haloRemove":
        return this.services.halo.remove(m.id);
      case "prompt":
        this.promptBusy = true;
        await this.post();
        try {
          await vscode.commands.executeCommand("ghostcode.prompt.fromSelection");
        } finally {
          this.promptBusy = false;
          await this.post();
        }
        return;
      case "copyPrompt":
        return void vscode.commands.executeCommand("ghostcode.prompt.copy", m.value);
      case "savePrompt":
        if (this.prompt) this.prompt = { ...this.prompt, text: m.value };
        return void vscode.commands.executeCommand("ghostcode.prompt.save", m.value);
      case "projectContext":
        return void vscode.commands.executeCommand("ghostcode.projectContext");
      case "refreshExtensions":
        this.recommendations = undefined;
        return this.post();
      case "installExt":
        try {
          await vscode.commands.executeCommand("workbench.extensions.installExtension", m.id);
          vscode.window.setStatusBarMessage(`$(check) Extensión ${m.id} instalada`, 5000);
        } catch (err) {
          void vscode.window.showErrorMessage(`No se pudo instalar ${m.id}: ${(err as Error).message}`);
        }
        this.recommendations = undefined;
        return this.post();
      case "showBroken":
        this.brokenShown = true;
        this.brokenBusy = true;
        await this.post();
        try {
          await this.services.paths.checkProject({ quiet: true });
        } finally {
          this.brokenBusy = false;
          await this.post();
        }
        return;
      case "hideBroken":
        this.brokenShown = false;
        return this.post();
      case "openBroken":
      case "fixBroken": {
        const at = { uri: m.uri, line: Number(m.line), start: Number(m.start), end: Number(m.end) };
        await this.services.paths.open(at, m.type === "fixBroken" ? m.value : undefined);
        return this.post();
      }
      case "openUrl":
        // Solo enlaces a GitHub (el del autor); nada arbitrario desde la vista.
        if (/^https:\/\/github\.com\/[\w.-]+\/?$/.test(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url));
        return;
      case "showExt":
        return void vscode.commands.executeCommand("workbench.extensions.search", `@id:${m.id}`);
      case "document":
        return void vscode.commands.executeCommand("ghostcode.documentFunction");
      case "fix":
        return void vscode.commands.executeCommand("ghostcode.fixWithAI");
      case "commit":
        return void vscode.commands.executeCommand("ghostcode.commitMessage");
      case "gitInit":
        return void vscode.commands.executeCommand("git.init");
      case "publish":
        return void vscode.commands.executeCommand("github.publish");
      case "openScm":
        return void vscode.commands.executeCommand("workbench.view.scm");
      case "openRemote": {
        const st = await this.git.status();
        if (st.status === "repo" && st.remote?.web) await vscode.env.openExternal(vscode.Uri.parse(st.remote.web));
        return;
      }
      case "mode":
        return m.mode === "api" ? enableApiMode(this.context.secrets) : update("mode", "local");
      case "useModel":
        await update("local.model", m.name);
        // Elegir un modelo local implica querer usarlo; si está desactivado se respeta.
        if (c.mode === "api") await update("mode", "local");
        return;
      case "useChatModel":
        return update("local.chatModel", m.name);
      case "pull":
        this.pulling.set(m.name, 0);
        await this.post();
        try {
          let lastPost = 0;
          await pullModel(c.localUrl, m.name, (pct) => {
            this.pulling.set(m.name, pct);
            // Sin saturar la vista: como mucho ~4 actualizaciones por segundo.
            if (Date.now() - lastPost > 250) {
              lastPost = Date.now();
              void this.post();
            }
          });
        } finally {
          this.pulling.delete(m.name);
          await this.refreshModels();
        }
        return;
      case "configureApi":
        return void vscode.commands.executeCommand("ghostcode.configureApi");
      case "indent":
        return void vscode.commands.executeCommand("ghostcode.fixIndentation");
      case "annotate":
        return void vscode.commands.executeCommand("ghostcode.annotate");
      case "settings":
        return void vscode.commands.executeCommand("workbench.action.openSettings", "ghostcode");
    }
  }

  private async post(): Promise<void> {
    if (!this.view) return;
    const state = await this.state();
    await this.view?.webview.postMessage({ type: "state", state });
  }

  /** Lo que muestra la vista (también lo usan las pruebas de integración). */
  async state() {
    const c = cfg();
    const hw = await getHardware();
    const names = this.installed?.map((m) => m.name) ?? [];
    return {
      enabled: c.mode !== "off",
      mode: c.mode === "off" ? this.getLastMode() : c.mode,
      backendLabel: this.getBackendLabel() ?? "Desactivado",
      apiLabel: `${PROVIDER_LABELS[c.apiProvider]} · ${c.apiModel || defaultApiModel(c.apiProvider) || "sin modelo"}`,
      localModel: c.localModel,
      chatModel: c.localChatModel,
      hoverExplain: c.hoverExplain,
      projectContext: c.projectContext,
      indexedFiles: this.project.fileCount,
      git: await this.git.status(),
      indentSize: c.indentSize,
      pathCheck: c.pathCheck,
      pathIssues: this.services.paths.issueCount,
      brokenShown: this.brokenShown,
      brokenBusy: this.brokenBusy,
      brokenPaths: this.brokenShown ? this.services.paths.broken() : [],
      version: String(this.context.extension.packageJSON.version ?? ""),
      haloEnabled: c.haloEnabled,
      haloPersisted: this.services.halo.isPersisted,
      halo: this.services.halo.list().map((h) => ({ id: h.id, name: h.name, input: h.input, files: h.files, functions: h.functions, tags: h.styleTags, summary: h.summary, cloned: h.cloned })),
      prompt: this.prompt,
      promptBusy: this.promptBusy,
      promptsFile: c.promptsFile,
      extensions: (this.recommendations ??= await extensionRecommendations(this.services.files, this.project, (await this.git.status()).status === "repo")),
      chatAuto: pickChatModel(names, c.localModel),
      installed: this.installed?.map((m) => ({ ...m, base: isCompletionOnly(m.name) })),
      ollamaError: this.ollamaError,
      hardware: describeHardware(hw),
      hw: { gpu: hw.gpu, vramGb: Math.round(hw.vramMb / 1024), ramGb: Math.round(hw.ramMb / 1024) },
      suggestions: suggestModels(hw).map((s) => ({
        ...s,
        installed: names.includes(s.name),
        pulling: this.pulling.get(s.name),
        active: s.use === "completion" ? s.name === c.localModel : s.name === (c.localChatModel || pickChatModel(names, c.localModel)),
      })),
    };
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "panel.js"));
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
<title>GhostCode</title>
</head>
<body>
<div id="app"><p class="muted">Cargando…</p></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

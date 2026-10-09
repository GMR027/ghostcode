import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { resolveAnnotationLanguage } from "./core/annotate";
import { cleanCommitMessage, commitRequest, parseRemote, type RemoteInfo } from "./core/git";
import { chatBackend, runChat } from "./tools";

// Subconjunto de la API de la extensión Git integrada (vscode.git, versión 1).
interface Change {
  uri: vscode.Uri;
  status: number;
}
interface Repository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
  state: {
    HEAD?: { name?: string; commit?: string; ahead?: number; behind?: number; upstream?: { remote: string; name: string } };
    remotes: { name: string; fetchUrl?: string; pushUrl?: string }[];
    indexChanges: Change[];
    workingTreeChanges: Change[];
    onDidChange: vscode.Event<void>;
  };
  diff(cached?: boolean): Promise<string>;
}
interface GitAPI {
  state: "uninitialized" | "initialized";
  repositories: Repository[];
  onDidChangeState: vscode.Event<string>;
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
  getRepository(uri: vscode.Uri): Repository | null;
}
const UNTRACKED = 7;

export type GitStatus =
  | { status: "no-folder" }
  | { status: "unavailable" }
  | { status: "no-repo"; folder: string }
  | {
      status: "repo";
      name: string;
      branch?: string;
      hasCommits: boolean;
      remote?: RemoteInfo & { name: string; url: string };
      changes: number;
      staged: number;
      ahead: number;
      behind: number;
    };

/** Estado del repositorio del proyecto abierto, a través de la extensión Git de VS Code. */
export class GitInfo implements vscode.Disposable {
  private api?: GitAPI;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<Repository, vscode.Disposable>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly ready: Promise<void>;

  constructor() {
    this.ready = this.init();
    this.disposables.push(this.changed, vscode.window.onDidChangeActiveTextEditor(() => this.changed.fire()));
  }

  private async init(): Promise<void> {
    const ext = vscode.extensions.getExtension<{ getAPI(v: 1): GitAPI }>("vscode.git");
    if (!ext) return;
    try {
      this.api = (await ext.activate()).getAPI(1);
    } catch {
      return; // git desactivado (git.enabled = false) o no instalado
    }
    const watch = (r: Repository) => {
      if (!this.repoListeners.has(r)) this.repoListeners.set(r, r.state.onDidChange(() => this.changed.fire()));
      this.changed.fire();
    };
    this.api.repositories.forEach(watch);
    this.disposables.push(
      this.api.onDidOpenRepository(watch),
      this.api.onDidCloseRepository((r) => {
        this.repoListeners.get(r)?.dispose();
        this.repoListeners.delete(r);
        this.changed.fire();
      }),
      this.api.onDidChangeState(() => this.changed.fire()),
    );
  }

  /** El repositorio del archivo activo o, si no, el de la primera carpeta. */
  repository(): Repository | undefined {
    if (!this.api) return undefined;
    const uri = vscode.window.activeTextEditor?.document.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    return (uri && this.api.getRepository(uri)) || this.api.repositories[0];
  }

  async status(): Promise<GitStatus> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return { status: "no-folder" };
    await this.ready;
    if (!this.api) return { status: "unavailable" };
    // Al abrir VS Code la extensión Git tarda un poco en descubrir los repositorios.
    if (this.api.state !== "initialized") {
      await new Promise<void>((resolve) => {
        const sub = this.api!.onDidChangeState(() => (sub.dispose(), resolve()));
        setTimeout(() => (sub.dispose(), resolve()), 5000);
      });
    }
    const repo = this.repository();
    if (!repo) return { status: "no-repo", folder: folder.name };
    const head = repo.state.HEAD;
    const origin = repo.state.remotes.find((r) => r.name === (head?.upstream?.remote ?? "origin")) ?? repo.state.remotes[0];
    const url = origin?.fetchUrl ?? origin?.pushUrl;
    const parsed = parseRemote(url);
    return {
      status: "repo",
      name: parsed ? `${parsed.owner}/${parsed.repo}` : repo.rootUri.path.split("/").pop() ?? "",
      branch: head?.name,
      hasCommits: Boolean(head?.commit),
      remote: parsed && origin && url ? { ...parsed, name: origin.name, url } : undefined,
      changes: new Set([...repo.state.workingTreeChanges, ...repo.state.indexChanges].map((c) => c.uri.toString())).size,
      staged: repo.state.indexChanges.length,
      ahead: head?.ahead ?? 0,
      behind: head?.behind ?? 0,
    };
  }

  dispose(): void {
    for (const d of [...this.disposables, ...this.repoListeners.values()]) d.dispose();
  }
}

/**
 * Escribe en el cuadro de Control de código fuente un mensaje de commit generado a
 * partir de los cambios preparados (o de todos, si no hay ninguno preparado).
 */
export async function generateCommitMessage(git: GitInfo, secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<void> {
  const st = await git.status();
  const repo = git.repository();
  if (st.status !== "repo" || !repo) {
    void vscode.window.showInformationMessage("GhostCode: este proyecto no está en un repositorio Git.");
    return;
  }
  let diff = await repo.diff(true);
  const staged = Boolean(diff.trim()) || repo.state.indexChanges.length > 0;
  if (!staged) diff = await repo.diff(false);
  // Archivos nuevos sin seguimiento: no salen en el diff, así que se envía su comienzo.
  const untracked = staged ? [] : repo.state.workingTreeChanges.filter((c) => c.status === UNTRACKED).slice(0, 15);
  const newFiles = await Promise.all(
    untracked.map(async (c, i) => {
      const path = vscode.workspace.asRelativePath(c.uri, false);
      if (i >= 4) return { path, head: "" };
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(c.uri));
        return { path, head: text.split("\n").slice(0, 30).join("\n").slice(0, 1500) };
      } catch {
        return { path, head: "" };
      }
    }),
  );
  if (!diff.trim() && !newFiles.length) {
    void vscode.window.showInformationMessage("GhostCode: no hay cambios para describir.");
    return;
  }
  const backend = await chatBackend(secrets, mode);
  if (!backend) return;
  const lang = resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env);
  const raw = await runChat(backend, commitRequest(diff, newFiles, st.branch, lang), "escribiendo el mensaje de commit", log);
  if (raw === undefined) return;
  const message = cleanCommitMessage(raw);
  if (!message) {
    void vscode.window.showWarningMessage("GhostCode: el modelo no devolvió un mensaje.");
    return;
  }
  repo.inputBox.value = message;
  await vscode.commands.executeCommand("workbench.view.scm");
  vscode.window.setStatusBarMessage(
    `$(check) GhostCode: mensaje de commit listo${staged ? "" : " (no había cambios preparados: se describieron todos)"}`,
    6000,
  );
}

import * as vscode from "vscode";

const EXCLUDE = "**/{node_modules,vendor,.git,.venv,venv,__pycache__,bower_components,.next,.nuxt,coverage,target,Pods,.gradle}/**";
const MAX_FILES = 30_000;

/** Lista de todos los archivos del proyecto (rutas relativas), al día con creaciones y borrados. */
export class WorkspaceFiles implements vscode.Disposable {
  private files?: Set<string>;
  private loading?: Promise<Set<string>>;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*");
    const rel = (uri: vscode.Uri) => vscode.workspace.asRelativePath(uri, false);
    this.disposables.push(
      watcher,
      this.changed,
      watcher.onDidCreate((uri) => {
        if (this.files && !/(^|\/)(node_modules|vendor|\.git)\//.test(rel(uri))) this.files.add(rel(uri));
        this.changed.fire();
      }),
      watcher.onDidDelete((uri) => {
        // Puede ser una carpeta: quitar todo lo que cuelga de ella.
        const r = rel(uri);
        if (this.files) for (const f of [...this.files]) if (f === r || f.startsWith(r + "/")) this.files.delete(f);
        this.changed.fire();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.files = undefined;
        this.loading = undefined;
      }),
    );
  }

  /** Carpetas de dependencias que existen en la raíz pero no se listan (vendor, node_modules…). */
  async opaqueDirs(): Promise<string[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [];
    const out: string[] = [];
    for (const d of ["vendor", "node_modules", "bower_components", ".venv", "venv"]) {
      if (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, d)).then(() => true, () => false)) out.push(d);
    }
    return out;
  }

  async list(): Promise<Set<string>> {
    if (this.files) return this.files;
    this.loading ??= Promise.resolve(vscode.workspace.findFiles("**/*", EXCLUDE, MAX_FILES)).then((uris) => {
      const files = new Set(uris.map((u) => vscode.workspace.asRelativePath(u, false)));
      this.files = files;
      return files;
    });
    return this.loading;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

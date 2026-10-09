import * as vscode from "vscode";
import { receiverClass, referencedNames } from "./core/declarations";
import { extractRoutes } from "./core/paths";
import { DeclarationIndex, familyOf } from "./core/projectContext";
import type { Snippet } from "./core/types";

const SOURCE_GLOB =
  "**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts,vue,svelte,php,py,rb,go,rs,java,kt,kts,scala,groovy,swift,c,h,cc,cpp,cxx,hpp,hh,cs,fs,dart,lua,ex,exs,erl,hs,ml,vb,pl,pm,r,jl,sql,sh,bash,ps1,clj,nim,zig,sol,m,mm}";
const EXCLUDE_GLOB =
  "**/{node_modules,vendor,dist,build,out,target,.git,.venv,venv,env,__pycache__,bower_components,.next,.nuxt,coverage,Pods,.gradle}/**";
const SOURCE_RE = new RegExp(`\\.(${/\{(.*)\}/.exec(SOURCE_GLOB)![1].replace(/,/g, "|")})$`, "i");
const MAX_FILES = 4000;
const MAX_BYTES = 300_000;

/** Índice de declaraciones del espacio de trabajo, actualizado al guardar/crear/borrar archivos. */
export class ProjectIndex implements vscode.Disposable {
  private readonly index = new DeclarationIndex();
  /** Ruta relativa (clave del índice) → URI real. */
  private readonly uris = new Map<string, vscode.Uri>();
  /** Rutas del enrutador definidas en cada archivo (/login, /api/x…). */
  private readonly routesByFile = new Map<string, string[]>();
  /** Archivos que consultan una base de datos (para recomendar extensiones). */
  private readonly sqlFiles = new Set<string>();
  private building?: Promise<void>;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly log: vscode.LogOutputChannel) {
    const watcher = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB);
    this.disposables.push(
      watcher,
      this.changed,
      watcher.onDidCreate((uri) => void this.indexFile(uri)),
      watcher.onDidChange((uri) => void this.indexFile(uri)),
      watcher.onDidDelete((uri) => {
        this.index.delete(this.key(uri));
        this.uris.delete(this.key(uri));
        this.routesByFile.delete(this.key(uri));
      }),
      vscode.workspace.onDidSaveTextDocument((doc) => this.indexText(doc.uri, doc.getText())),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.building = undefined;
        void this.ensure();
      }),
    );
  }

  get fileCount(): number {
    return this.index.fileCount;
  }

  get isReady(): boolean {
    return this.building !== undefined && this.index.fileCount > 0;
  }

  lookup(name: string) {
    void this.ensure();
    return this.index.lookup(name);
  }

  get usesSql(): boolean {
    return this.sqlFiles.size > 0;
  }

  /** Resumen de las clases y funciones del proyecto (para documentar el proyecto). */
  outlines(maxChars = 6000): string[] {
    return this.index.outlines(maxChars);
  }

  /** Todas las rutas del enrutador del proyecto. */
  routes(): string[] {
    return [...new Set([...this.routesByFile.values()].flat())];
  }

  uriOf(path: string): vscode.Uri | undefined {
    return this.uris.get(path);
  }

  /** Archivos indexados del mismo "idioma" que `uri` (para buscar referencias). */
  sameFamily(uri: vscode.Uri): vscode.Uri[] {
    const ext = (p: string) => p.slice(p.lastIndexOf(".") + 1).toLowerCase();
    const fam = familyOf(ext(uri.path));
    return [...this.uris.values()].filter((u) => familyOf(ext(u.path)) === fam);
  }

  /** Indexa el proyecto la primera vez (en segundo plano). */
  ensure(): Promise<void> {
    this.building ??= this.build();
    return this.building;
  }

  /**
   * Firmas de las clases y funciones del proyecto que se usan cerca del cursor.
   * No espera: si el índice aún se está construyendo devuelve lo que haya.
   */
  snippets(doc: vscode.TextDocument, textBeforeCursor: string): Snippet[] {
    void this.ensure();
    if (!this.index.fileCount) return [];
    const tail = textBeforeCursor.slice(-3000);
    const names = referencedNames(tail);
    // `variable->`: la clase de esa variable va primero (es la API que se está usando).
    const receiver = receiverClass(textBeforeCursor.slice(-6000));
    if (receiver) names.unshift(receiver);
    // El más relevante al final: queda justo antes del código, donde más influye.
    return this.index.snippetsFor(names, this.key(doc.uri)).reverse();
  }

  private key(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
  }

  private async build(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    const t0 = Date.now();
    const files = await vscode.workspace.findFiles(SOURCE_GLOB, EXCLUDE_GLOB, MAX_FILES);
    for (let i = 0; i < files.length; i++) {
      await this.indexFile(files[i], false);
      // Ceder el hilo de vez en cuando para no bloquear el editor.
      if (i % 40 === 39) await new Promise((r) => setImmediate(r));
    }
    this.log.info(`Contexto del proyecto: ${this.index.fileCount} archivos indexados en ${Date.now() - t0} ms`);
    this.changed.fire();
  }

  private async indexFile(uri: vscode.Uri, notify = true): Promise<void> {
    try {
      if (/\.min\.\w+$/.test(uri.path)) return;
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > MAX_BYTES) return;
      const bytes = await vscode.workspace.fs.readFile(uri);
      this.indexText(uri, new TextDecoder().decode(bytes), notify);
    } catch {
      // Archivo borrado o ilegible: ignorar.
    }
  }

  private indexText(uri: vscode.Uri, text: string, notify = true): void {
    if (!SOURCE_RE.test(uri.path) || /[\\/](node_modules|vendor)[\\/]/.test(uri.path) || !vscode.workspace.getWorkspaceFolder(uri)) return;
    this.index.set(this.key(uri), text);
    this.uris.set(this.key(uri), uri);
    if (/\b(mysqli|PDO|sqlite3|psycopg2?|mongoose|createConnection|SELECT\s[\s\S]{0,80}?\sFROM|INSERT\s+INTO)\b/i.test(text)) this.sqlFiles.add(this.key(uri));
    else this.sqlFiles.delete(this.key(uri));
    const routes = extractRoutes(text);
    if (routes.length) this.routesByFile.set(this.key(uri), routes);
    else this.routesByFile.delete(this.key(uri));
    if (notify) this.changed.fire();
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

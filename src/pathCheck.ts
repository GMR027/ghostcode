import * as vscode from "vscode";
import { cfg } from "./config";
import { checkRef, findPathRefs, projectFiles, supportsPaths, type ProjectFiles } from "./core/paths";
import type { ProjectIndex } from "./projectIndex";
import type { WorkspaceFiles } from "./workspaceFiles";

const LANG_BY_EXT: Record<string, string> = {
  html: "html", htm: "html", php: "php", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  ts: "typescript", tsx: "typescriptreact", vue: "vue", svelte: "svelte", css: "css", scss: "scss", sass: "sass",
  less: "less", md: "markdown", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", rb: "ruby", astro: "astro",
};
export interface BrokenPath {
  uri: string;
  /** Ruta relativa del archivo (para mostrar). */
  file: string;
  line: number;
  start: number;
  end: number;
  /** La ruta rota tal como está escrita. */
  value: string;
  /** La corrección más probable, si hay. */
  suggestion?: string;
}

const SCAN_GLOB = `**/*.{${Object.keys(LANG_BY_EXT).join(",")}}`;
const EXCLUDE = "**/{node_modules,vendor,.git,dist,build,out,coverage,.next,.nuxt}/**";

/**
 * «Corrección de rutas»: marca en Problemas las rutas que no existen en el proyecto
 * (href, src, import, require, include, url()…) y ofrece la corrección con Ctrl+.
 */
export class PathChecker implements vscode.CodeActionProvider, vscode.Disposable {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];
  private readonly diags = vscode.languages.createDiagnosticCollection("ghostcode-rutas");
  /** Correcciones propuestas: "uri|línea|columna" → rutas. */
  private readonly fixes = new Map<string, string[]>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly files: WorkspaceFiles,
    private readonly project: ProjectIndex,
  ) {
    const later = (doc: vscode.TextDocument) => {
      clearTimeout(this.timers.get(doc.uri.toString()));
      this.timers.set(doc.uri.toString(), setTimeout(() => void this.checkDocument(doc), 600));
    };
    this.disposables.push(
      this.diags,
      this.changed,
      vscode.workspace.onDidOpenTextDocument((d) => later(d)),
      vscode.workspace.onDidChangeTextDocument((e) => later(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.diags.delete(d.uri)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("ghostcode.pathCheck")) this.recheckOpen();
      }),
      // Al crear o borrar archivos, una ruta rota puede dejar de estarlo (o al revés).
      files.onDidChange(() => this.recheckOpen()),
    );
    this.recheckOpen();
  }

  /** Cuántas rutas rotas hay marcadas ahora mismo. */
  get issueCount(): number {
    let n = 0;
    this.diags.forEach((_, d) => (n += d.length));
    return n;
  }

  private recheckOpen(): void {
    for (const doc of vscode.workspace.textDocuments) void this.checkDocument(doc);
  }

  private async pf(): Promise<ProjectFiles> {
    await this.project.ensure();
    return projectFiles([...(await this.files.list())], this.project.routes(), await this.files.opaqueDirs());
  }

  async checkDocument(doc: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    if (!cfg().pathCheck || doc.uri.scheme !== "file" || !supportsPaths(doc.languageId) || !vscode.workspace.getWorkspaceFolder(doc.uri)) {
      this.diags.delete(doc.uri);
      return [];
    }
    const found = this.checkText(doc.uri, doc.getText(), doc.languageId, await this.pf());
    this.diags.set(doc.uri, found);
    this.changed.fire();
    return found;
  }

  private checkText(uri: vscode.Uri, text: string, languageId: string, pf: ProjectFiles): vscode.Diagnostic[] {
    const fileRel = vscode.workspace.asRelativePath(uri, false);
    const out: vscode.Diagnostic[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.length > 2000) return;
      for (const ref of findPathRefs(line, languageId)) {
        const res = checkRef(ref, fileRel, pf);
        if (res.ok) continue;
        const hint = res.suggestions.length ? ` ¿Quisiste decir «${res.suggestions[0]}»?` : "";
        const d = new vscode.Diagnostic(new vscode.Range(i, ref.start, i, ref.end), `La ruta «${ref.value}» no existe en el proyecto.${hint}`, vscode.DiagnosticSeverity.Warning);
        d.source = "GhostCode";
        d.code = "ruta";
        this.fixes.set(`${uri.toString()}|${i}|${ref.start}`, res.suggestions);
        out.push(d);
      }
    });
    return out;
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      if (d.source !== "GhostCode" || d.code !== "ruta") continue;
      const options = this.fixes.get(`${doc.uri.toString()}|${d.range.start.line}|${d.range.start.character}`) ?? [];
      options.forEach((s, i) => {
        const a = new vscode.CodeAction(`GhostCode: corregir ruta → «${s}»`, vscode.CodeActionKind.QuickFix);
        a.diagnostics = [d];
        a.isPreferred = i === 0;
        a.edit = new vscode.WorkspaceEdit();
        a.edit.replace(doc.uri, d.range, s);
        actions.push(a);
      });
    }
    return actions;
  }

  /** Revisa el archivo activo; si la línea del cursor tiene una ruta rota, ofrece corregirla. */
  async fixAtCursor(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage("GhostCode: abre un archivo para revisar sus rutas.");
      return;
    }
    const doc = editor.document;
    if (!supportsPaths(doc.languageId)) {
      void vscode.window.showInformationMessage(`GhostCode: la corrección de rutas no aplica a archivos ${doc.languageId}.`);
      return;
    }
    const wasEnabled = cfg().pathCheck;
    const found = wasEnabled ? await this.checkDocument(doc) : this.checkText(doc.uri, doc.getText(), doc.languageId, await this.pf());
    if (!wasEnabled) this.diags.set(doc.uri, found);
    const line = editor.selection.active.line;
    const here = found.filter((d) => d.range.start.line === line);
    if (!here.length) {
      if (found.length) {
        void vscode.window.showWarningMessage(`GhostCode: esta línea está bien, pero hay ${found.length} ruta(s) rota(s) en el archivo.`, "Ver problemas").then((c) => {
          if (c) void vscode.commands.executeCommand("workbench.actions.view.problems");
        });
      } else {
        vscode.window.setStatusBarMessage("$(check) GhostCode: todas las rutas del archivo existen", 5000);
      }
      return;
    }
    for (const d of here) {
      const options = this.fixes.get(`${doc.uri.toString()}|${d.range.start.line}|${d.range.start.character}`) ?? [];
      const current = doc.getText(d.range);
      const write = "$(edit) Escribir la ruta…";
      const pick = await vscode.window.showQuickPick([...options.map((o) => ({ label: o })), { label: write }], {
        title: `GhostCode — «${current}» no existe`,
        placeHolder: options.length ? "Elige la ruta correcta" : "No se encontró un archivo parecido",
      });
      if (!pick) return;
      const value = pick.label === write ? await vscode.window.showInputBox({ title: "Ruta correcta", value: current }) : pick.label;
      if (!value || value === current) continue;
      await editor.edit((eb) => eb.replace(d.range, value));
    }
  }

  /** Rutas rotas marcadas ahora mismo (para listarlas en el panel). */
  broken(max = 200): BrokenPath[] {
    const out: BrokenPath[] = [];
    this.diags.forEach((uri, ds) => {
      for (const d of ds) {
        if (out.length >= max) return;
        const value = /«([^»]*)»/.exec(d.message)?.[1] ?? "";
        out.push({
          uri: uri.toString(),
          file: vscode.workspace.asRelativePath(uri, false),
          line: d.range.start.line,
          start: d.range.start.character,
          end: d.range.end.character,
          value,
          suggestion: this.fixes.get(`${uri.toString()}|${d.range.start.line}|${d.range.start.character}`)?.[0],
        });
      }
    });
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }

  /** Abre el archivo en la ruta rota y, si se indica, la reemplaza (el usuario ve el cambio y guarda). */
  async open(b: Pick<BrokenPath, "uri" | "line" | "start" | "end">, replacement?: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(b.uri));
    const range = new vscode.Range(b.line, b.start, b.line, b.end);
    const editor = await vscode.window.showTextDocument(doc, { selection: range, preview: false });
    if (replacement === undefined) return;
    await editor.edit((eb) => eb.replace(range, replacement));
    editor.selection = new vscode.Selection(b.line, b.start, b.line, b.start + replacement.length);
    await this.checkDocument(doc);
  }

  /** Revisa todos los archivos del proyecto y deja los resultados en Problemas. */
  async checkProject(opts: { quiet?: boolean } = {}): Promise<void> {
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "GhostCode: revisando rutas del proyecto…" },
      async () => {
        const pf = await this.pf();
        const uris = await vscode.workspace.findFiles(SCAN_GLOB, EXCLUDE, 5000);
        let issues = 0;
        let filesWithIssues = 0;
        for (const uri of uris) {
          const ext = uri.path.slice(uri.path.lastIndexOf(".") + 1).toLowerCase();
          const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
          const text = open?.getText() ?? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          const found = this.checkText(uri, text, open?.languageId ?? LANG_BY_EXT[ext], pf);
          this.diags.set(uri, found);
          issues += found.length;
          if (found.length) filesWithIssues++;
        }
        this.changed.fire();
        return { issues, filesWithIssues, files: uris.length };
      },
    );
    if (opts.quiet) return;
    if (!result.issues) {
      void vscode.window.showInformationMessage(`GhostCode: las rutas de ${result.files} archivos son correctas.`);
      return;
    }
    // Sin await: la notificación no debe dejar el comando esperando a que se cierre.
    void vscode.window
      .showWarningMessage(
        `GhostCode: ${result.issues} ruta(s) rota(s) en ${result.filesWithIssues} archivo(s). Usa Ctrl+. sobre cada una para corregirla.`,
        "Ver problemas",
      )
      .then((choice) => choice && vscode.commands.executeCommand("workbench.actions.view.problems"));
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}

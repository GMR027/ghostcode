import * as vscode from "vscode";
import { scanA11y, type A11yIssue } from "./core/a11y";
import { findUnusedImports, findUnusedSymbols } from "./core/deadcode";
import { codeUnits, findDuplicates } from "./core/duplicates";
import type { WorkspaceFiles } from "./workspaceFiles";

const SOURCE = /\.(m?[jt]sx?|cjs|vue|svelte|astro|php|py|rb|go|rs|java|kt|kts|cs|c|h|cc|cpp|hpp|lua|sh|bash)$/i;
const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[^.]+$|(^|\/)test_.*\.py$/i;
const MARKUP = /\.(html?|php|vue|svelte|astro|jsx|tsx|twig|blade\.php|hbs|handlebars)$/i;

export interface DuplicateView {
  a: { path: string; name: string; line: number; end: number; snippet: string; uri: string };
  b: { path: string; name: string; line: number; end: number; snippet: string; uri: string };
  similarity: number;
}

export interface QualityState {
  busy: boolean;
  scannedAt?: number;
  files: number;
  units: number;
  duplicates: DuplicateView[];
  dead: { path: string; name: string; kind: string; line: number; signature: string; uri: string }[];
  unusedImports: { path: string; name: string; line: number; source: string; uri: string }[];
  a11y: A11yIssue[];
  a11yFile?: string;
  a11yUri?: string;
  error?: string;
}

const empty = (): QualityState => ({ busy: false, files: 0, units: 0, duplicates: [], dead: [], unusedImports: [], a11y: [] });

/**
 * Analiza el proyecto en busca de duplicados, código muerto y problemas de
 * accesibilidad del archivo activo. Todo local: no usa IA ni envía nada.
 */
export class QualityService {
  private result: QualityState = empty();

  constructor(
    private readonly files: WorkspaceFiles,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  state(): QualityState {
    return this.result;
  }

  async scan(): Promise<QualityState> {
    if (this.result.busy) return this.result;
    this.result = { ...empty(), busy: true };
    const started = Date.now();
    try {
      const root = vscode.workspace.workspaceFolders?.[0];
      if (!root) {
        this.result = { ...empty(), error: "Abre una carpeta para analizarla." };
        return this.result;
      }
      const list = [...(await this.files.list())];
      const sourcePaths = list
        .filter((p) => SOURCE.test(p) && !TEST_FILE.test(p) && !/\.min\.\w+$|\.d\.ts$/i.test(p))
        .slice(0, 1600);
      const sources: { path: string; text: string }[] = [];
      for (let i = 0; i < sourcePaths.length; i++) {
        try {
          const uri = vscode.Uri.joinPath(root.uri, sourcePaths[i]);
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 300_000) continue;
          const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
          sources.push({ path: sourcePaths[i], text });
        } catch {
          // Archivo ilegible o borrado: ignorar.
        }
        if (i % 40 === 39) await new Promise((r) => setImmediate(r));
      }

      const units = codeUnits(sources);
      const pairs = findDuplicates(units, { threshold: 0.76, maxPairs: 40 });
      const dead = findUnusedSymbols(sources, 60);
      const unusedImports = findUnusedImports(sources, 60);

      const editor = vscode.window.activeTextEditor;
      const a11y: A11yIssue[] = [];
      let a11yFile: string | undefined;
      let a11yUri: string | undefined;
      if (editor && MARKUP.test(editor.document.uri.path)) {
        a11yFile = vscode.workspace.asRelativePath(editor.document.uri, false);
        a11yUri = editor.document.uri.toString();
        a11y.push(...scanA11y(editor.document.getText()).slice(0, 80));
      }

      const uriOf = (path: string) => vscode.Uri.joinPath(root.uri, path).toString();
      this.result = {
        busy: false,
        scannedAt: Date.now(),
        files: sources.length,
        units: units.length,
        duplicates: pairs.map((p) => ({
          a: { path: p.a.path, name: p.a.name, line: p.a.line, end: p.a.end, snippet: p.a.text.split("\n")[0].trim().slice(0, 140), uri: uriOf(p.a.path) },
          b: { path: p.b.path, name: p.b.name, line: p.b.line, end: p.b.end, snippet: p.b.text.split("\n")[0].trim().slice(0, 140), uri: uriOf(p.b.path) },
          similarity: Math.round(p.similarity * 100),
        })),
        dead: dead.map((d) => ({ path: d.path, name: d.name, kind: d.kind, line: d.line, signature: d.signature, uri: uriOf(d.path) })),
        unusedImports: unusedImports.map((u) => ({ ...u, uri: uriOf(u.path) })),
        a11y,
        a11yFile,
        a11yUri,
      };
      this.log.info(`Calidad: ${sources.length} archivos, ${pairs.length} duplicados, ${dead.length} símbolos sin uso en ${Date.now() - started} ms`);
    } catch (err) {
      this.result = { ...empty(), error: (err as Error).message };
    }
    return this.result;
  }
}

import * as path from "node:path";
import * as vscode from "vscode";
import { cfg } from "./config";
import { CompletionCache } from "./core/cache";
import { findSimilarSnippets, type OpenFile } from "./core/neighbors";
import { finalizeCompletion, shouldBeMultiline, trimToBlock, type CursorContext } from "./core/postprocess";
import { BackendError, type Backend, type CompletionRequest } from "./core/types";
import type { HaloService } from "./halo";
import type { ProjectIndex } from "./projectIndex";
import type { StatusBar } from "./statusBar";

const SUPPORTED_SCHEMES = new Set(["file", "untitled", "vscode-notebook-cell", "vscode-remote", "vscode-vfs"]);
const SECRET_FILE_RE = /(^|\/)\.env(\..*)?$|\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519|ecdsa)$/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GhostCodeProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new CompletionCache();
  private lastErrorNotice = new Map<string, number>();

  constructor(
    private readonly getBackend: () => Backend | undefined,
    private readonly status: StatusBar,
    private readonly log: vscode.LogOutputChannel,
    private readonly project?: ProjectIndex,
    private readonly halo?: HaloService,
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const backend = this.getBackend();
    if (!backend) return;
    const c = cfg();
    if (!SUPPORTED_SCHEMES.has(doc.uri.scheme)) return;
    if (c.disabledLanguages.includes(doc.languageId)) return;
    if (SECRET_FILE_RE.test(doc.fileName)) return;

    const manual = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;

    // Si el menú de IntelliSense está abierto, completamos a partir del elemento seleccionado.
    const selected = context.selectedCompletionInfo;
    const replaceStart = selected ? selected.range.start : pos;

    const offset = doc.offsetAt(pos);
    const prefixStart = doc.positionAt(Math.max(0, offset - c.maxPrefixChars));
    let prefix = doc.getText(new vscode.Range(new vscode.Position(prefixStart.line, 0), pos));
    const suffixEnd = doc.positionAt(offset + c.maxSuffixChars);
    const suffix = doc.getText(new vscode.Range(pos, suffixEnd));
    let lineBefore = doc.lineAt(pos.line).text.slice(0, pos.character);
    const lineAfter = doc.lineAt(pos.line).text.slice(pos.character);

    if (selected) {
      const typed = doc.getText(selected.range);
      if (!selected.text.startsWith(typed)) return;
      const extra = selected.text.slice(typed.length);
      prefix += extra;
      lineBefore += extra;
    }

    const multiline =
      c.multiline === "always" ? true : c.multiline === "never" ? false : shouldBeMultiline(lineBefore, lineAfter);
    const cc: CursorContext = { lineBefore, lineAfter, suffix, multiline };
    const cacheKey = `${backend.id}|${multiline}`;

    const cached = this.cache.get(cacheKey, prefix, suffix);
    if (cached !== undefined) return this.toItems(cached, selected, replaceStart, pos);

    // Debounce: esperar a que el usuario haga una pausa al escribir.
    const debounce = c.debounceMs > 0 ? c.debounceMs : backend.id.startsWith("ollama:") ? 120 : 250;
    if (!manual) {
      await sleep(debounce);
      if (token.isCancellationRequested) return;
    }

    const req: CompletionRequest = {
      prefix,
      suffix,
      filePath: vscode.workspace.asRelativePath(doc.uri, false) || path.basename(doc.fileName),
      languageId: doc.languageId,
      snippets: [
        ...(c.neighborTabs ? findSimilarSnippets(prefix, this.openFiles(doc)) : []),
        // API real de las clases/funciones del proyecto que se usan cerca del cursor.
        // Halo IA: funciones del propio usuario parecidas a lo que escribe.
        ...(this.halo ? this.halo.snippets(prefix, doc.fileName, doc.languageId) : []),
        ...(c.projectContext && this.project ? this.project.snippets(doc, prefix) : []),
      ],
      style: this.halo?.styleLine(),
      multiline,
      maxTokens: c.maxTokens,
      temperature: c.temperature,
    };

    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    const t0 = Date.now();
    let raw = "";
    this.status.begin();
    let latency: number | undefined;
    let stoppedEarly = false;
    try {
      for await (const piece of backend.complete(req, abort.signal)) {
        raw += piece;
        // Corte temprano: en cuanto el bloque está completo dejamos de generar.
        if (trimToBlock(backend.isChat ? raw.replace(/^```[^\n]*\n/, "") : raw, cc, false).done) {
          stoppedEarly = true;
          break;
        }
      }
      latency = Date.now() - t0;
    } catch (err) {
      if (token.isCancellationRequested) return;
      if (!stoppedEarly) {
        this.handleError(err);
        return;
      }
    } finally {
      abort.abort();
      sub.dispose();
      this.status.end(latency);
    }

    const text = finalizeCompletion(raw, cc, backend.isChat);
    this.log.debug(`[${backend.id}] ${latency} ms, ${raw.length} chars → ${JSON.stringify(text ?? "")}`);
    if (text === undefined) return;
    this.cache.set(cacheKey, prefix, suffix, text);
    if (token.isCancellationRequested) return;
    return this.toItems(text, selected, replaceStart, pos);
  }

  private toItems(
    text: string,
    selected: vscode.SelectedCompletionInfo | undefined,
    replaceStart: vscode.Position,
    pos: vscode.Position,
  ): vscode.InlineCompletionItem[] {
    const insert = selected ? selected.text + text : text;
    return [new vscode.InlineCompletionItem(insert, new vscode.Range(replaceStart, pos))];
  }

  private openFiles(current: vscode.TextDocument): OpenFile[] {
    const uris = new Set<string>();
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) uris.add(tab.input.uri.toString());
      }
    }
    const files: OpenFile[] = [];
    for (const d of vscode.workspace.textDocuments) {
      if (d === current || !uris.has(d.uri.toString()) || SECRET_FILE_RE.test(d.fileName)) continue;
      files.push({ path: vscode.workspace.asRelativePath(d.uri, false), text: d.getText() });
      if (files.length >= 20) break;
    }
    return files;
  }

  private handleError(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.log.error(msg);
    this.status.error(msg);
    const kind = err instanceof BackendError ? err.kind : "other";
    // No inundar al usuario: como mucho un aviso por tipo de error cada 2 minutos.
    const now = Date.now();
    if (now - (this.lastErrorNotice.get(kind) ?? 0) < 120_000) return;
    this.lastErrorNotice.set(kind, now);
    const actions = kind === "auth" ? ["Guardar API key", "Cambiar modo"] : ["Cambiar modo", "Ver registro"];
    void vscode.window.showWarningMessage(`GhostCode: ${msg}`, ...actions).then((choice) => {
      if (choice === "Guardar API key") void vscode.commands.executeCommand("ghostcode.setApiKey");
      else if (choice === "Cambiar modo") void vscode.commands.executeCommand("ghostcode.selectMode");
      else if (choice === "Ver registro") this.log.show();
    });
  }
}

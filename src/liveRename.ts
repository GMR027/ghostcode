import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import {
  applySpans, classTokenSpans, contextAt, diffClassAttr, diffIdentifier, diffSelectorClass, parseJudge, renameJudgeRequest,
  jsClassSpans, selectorSpans, styleBlocks, usesClass, wordSpans, type Candidate, type Renamed, type Span,
} from "./core/liveRename";
import { documentSymbols, enclosingSymbol, flattenSymbols, KINDS } from "./symbols";
import { chatBackend } from "./tools";

const STYLE_LANGS = new Set(["css", "scss", "sass", "less"]);
const SKIP_LANGS = new Set(["plaintext", "markdown", "json", "jsonc", "log", "git-commit", "scminput", "yaml", "xml"]);
const MARKUP_GLOB = "**/*.{html,htm,php,vue,jsx,tsx,svelte,astro,twig,blade.php}";
const SCRIPT_GLOB = "**/*.{js,mjs,ts}";
const STYLE_GLOB = "**/*.{css,scss,sass,less}";
const EXCLUDE = "**/{node_modules,vendor,.git,dist,build,out,coverage,.next,.nuxt}/**";
const MAX_FILES = 400;
const MAX_TEXT = 600_000;

/** Lo que se escribió en una línea desde que empezó la ráfaga de ediciones. */
interface Burst {
  uri: string;
  line: number;
  before: string;
  beforeText: string;
  lineCount: number;
}
type FileEdits = Map<string, { uri: vscode.Uri; spans: Span[] }>;

/**
 * «Renombrado en vivo»: al cambiar el nombre de una variable, función o clase (o de una clase
 * CSS), propaga el cambio por el archivo y, para las clases, por el marcado y las hojas de estilo.
 */
export class LiveRename implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  /** Texto de cada documento antes de la edición en curso. */
  private readonly texts = new Map<string, string>();
  private burst?: Burst;
  private timer?: NodeJS.Timeout;
  private applying = false;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly mode: () => Exclude<Mode, "off">,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.remember(d)),
      vscode.workspace.onDidCloseTextDocument((d) => this.texts.delete(d.uri.toString())),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
    );
    for (const d of vscode.workspace.textDocuments) this.remember(d);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }

  private remember(doc: vscode.TextDocument): void {
    if (doc.uri.scheme === "file" || doc.uri.scheme === "untitled") {
      if (doc.getText().length <= MAX_TEXT) this.texts.set(doc.uri.toString(), doc.getText());
    }
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;
    const key = doc.uri.toString();
    const before = this.texts.get(key);
    this.remember(doc);
    if (this.applying || !cfg().liveRename || before === undefined || e.contentChanges.length === 0) return;
    const isActive = vscode.window.activeTextEditor?.document === doc;
    const ch = e.contentChanges[0];
    const simple = e.contentChanges.length === 1 && ch.range.isSingleLine && !ch.text.includes("\n") && !e.reason;
    if (!isActive || SKIP_LANGS.has(doc.languageId) || !simple) {
      this.burst = undefined;
      return;
    }
    const line = ch.range.start.line;
    if (this.burst?.uri !== key || this.burst.line !== line) {
      const beforeLines = before.split("\n");
      this.burst = { uri: key, line, before: beforeLines[line] ?? "", beforeText: before, lineCount: beforeLines.length };
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.settle(doc).catch((err) => this.log.error(`Renombrado en vivo: ${(err as Error).message}`)), 900);
  }

  /** El usuario dejó de escribir: ¿lo que cambió fue un nombre? */
  private async settle(doc: vscode.TextDocument): Promise<void> {
    const burst = this.burst;
    this.burst = undefined;
    if (!burst || burst.uri !== doc.uri.toString() || doc.isClosed || doc.lineCount !== burst.lineCount || !cfg().liveRename) return;
    const after = doc.lineAt(burst.line).text;
    if (STYLE_LANGS.has(doc.languageId)) {
      const r = diffSelectorClass(burst.before, after);
      if (r) await this.renameClass(doc, r, true);
      return;
    }
    const cls = diffClassAttr(burst.before, after);
    if (cls) return this.renameClass(doc, cls, false);
    const id = diffIdentifier(burst.before, after);
    if (id) await this.renameIdentifier(doc, burst, id);
  }

  // --- Variables, funciones y clases del lenguaje ---------------------------------------

  private async renameIdentifier(doc: vscode.TextDocument, burst: Burst, r: Renamed): Promise<void> {
    const text = doc.getText();
    const version = doc.version;
    const lineStart = doc.offsetAt(new vscode.Position(burst.line, 0));
    const here: Span = { start: lineStart + r.col, end: lineStart + r.col + r.new.length };
    const pos = doc.positionAt(here.start);

    // Solo se propaga cuando se cambia la DECLARACIÓN (el primer uso del nombre, o un símbolo del
    // lenguaje); si se cambió un uso, es otro cambio de código y no un renombrado.
    const oldFirst = wordSpans(burst.beforeText, r.old)[0];
    const beforeLineStart = burst.beforeText.split("\n").slice(0, burst.line).reduce((n, l) => n + l.length + 1, 0);
    let isDeclaration = oldFirst?.start === beforeLineStart + r.col;
    const symbols = await documentSymbols(doc);
    if (!isDeclaration) {
      isDeclaration = flattenSymbols(symbols).some((s) => s.name === r.new && s.selectionRange.contains(pos));
    }
    if (!isDeclaration || doc.version !== version) return;

    // Una variable local solo se renombra dentro de su función; funciones y clases, en todo el archivo.
    const fn = enclosingSymbol(symbols, pos, "function");
    const own = flattenSymbols(symbols).some((s) => s.selectionRange.contains(pos));
    const scope: Span | undefined =
      fn && KINDS.has(fn.kind) && !/class|interface|enum|struct/.test(KINDS.get(fn.kind)!) && !own
        ? { start: doc.offsetAt(fn.range.start), end: doc.offsetAt(fn.range.end) }
        : undefined;

    const inScope = (s: Span) => s.start !== here.start;
    if (wordSpans(text, r.new, scope).some(inScope)) {
      void vscode.window.setStatusBarMessage(`$(info) GhostCode: «${r.new}» ya existe aquí; no se renombró «${r.old}».`, 6000);
      return;
    }
    const found = wordSpans(text, r.old, scope);
    if (!found.length) return;

    // Código y comentarios se renombran; cadenas y propiedades de otros objetos son dudosas.
    const sure: Span[] = [];
    const doubtful: Candidate[] = [];
    found.forEach((s, i) => {
      const context = contextAt(text, s.start);
      if (context === "code" || context === "comment") sure.push(s);
      else doubtful.push({ i, line: doc.lineAt(doc.positionAt(s.start).line).text, context });
    });
    const approved = doubtful.length ? await this.judge(doc, r, doc.lineAt(burst.line).text, doubtful) : [];
    const spans = [...sure, ...approved.map((i) => found[i])].sort((a, b) => a.start - b.start);
    if (!spans.length) return;
    if (doc.version !== version) return; // el usuario siguió escribiendo

    const files: FileEdits = new Map([[doc.uri.toString(), { uri: doc.uri, spans }]]);
    await this.apply(files, r.old, r.new, `«${r.old}» → «${r.new}»`);
  }

  /** Pregunta al modelo (en silencio) cuáles coincidencias dudosas son la misma cosa. */
  private async judge(doc: vscode.TextDocument, r: Renamed, edited: string, cands: Candidate[]): Promise<number[]> {
    if (!cfg().liveRenameAI) return [];
    try {
      const backend = await chatBackend(this.secrets, this.mode(), false);
      if (!backend) return [];
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 20_000);
      let out = "";
      try {
        for await (const piece of backend.chat(renameJudgeRequest(r.old, r.new, edited, cands.slice(0, 20), doc.languageId), abort.signal)) out += piece;
      } finally {
        clearTimeout(timer);
      }
      return parseJudge(out, cands.map((c) => c.i));
    } catch (err) {
      this.log.info(`Renombrado en vivo: el modelo no pudo decidir las coincidencias dudosas (${(err as Error).message}).`);
      return [];
    }
  }

  // --- Clases CSS ----------------------------------------------------------------------------

  private async renameClass(doc: vscode.TextDocument, r: Renamed, fromStyle: boolean): Promise<void> {
    const bem = cfg().bem;
    const { markup, styles, scripts } = await this.projectFiles(doc);
    const files: FileEdits = new Map();
    const add = (uri: vscode.Uri, spans: Span[]) => {
      if (!spans.length) return;
      const e = files.get(uri.toString()) ?? { uri, spans: [] };
      e.spans.push(...spans);
      files.set(uri.toString(), e);
    };
    const here = doc.uri.toString();
    const text = (u: vscode.Uri) => (u.toString() === here ? doc.getText() : markup.get(u.toString())?.text ?? styles.get(u.toString())?.text ?? "");
    const jsSpans = (t: string) => jsClassSpans(t, r.old, bem);
    const inlineStyles = (t: string) => styleBlocks(t).flatMap((b) => selectorSpans(t.slice(b.start, b.end), r.old, bem).map((s) => ({ start: s.start + b.start, end: s.end + b.start })));

    // ¿Ya existe el nombre nuevo como selector? Entonces no se mezclan clases en silencio.
    const taken = [...styles.values()].some((f) => selectorSpans(f.text, r.new).length) || (STYLE_LANGS.has(doc.languageId) ? false : styleBlocks(doc.getText()).some((b) => selectorSpans(doc.getText().slice(b.start, b.end), r.new).length));
    if (taken) {
      void vscode.window.setStatusBarMessage(`$(info) GhostCode: la clase «${r.new}» ya existe en los estilos; no se renombró «${r.old}».`, 6000);
      return;
    }

    if (!fromStyle) {
      // Cambio en el marcado: el archivo actual siempre; hojas de estilo solo si ninguna otra página usa la clase.
      const mine = text(doc.uri);
      const hereSpans = classTokenSpans(mine, r.old, bem);
      const others = [...markup.values()].filter((f) => f.uri.toString() !== here && usesClass(f.text, r.old));
      add(doc.uri, hereSpans);
      add(doc.uri, jsSpans(mine));
      add(doc.uri, STYLE_LANGS.has(doc.languageId) ? [] : inlineStyles(mine));
      if (!others.length) {
        for (const f of styles.values()) add(f.uri, selectorSpans(f.text, r.old, bem));
        for (const f of scripts.values()) add(f.uri, jsSpans(f.text));
      } else {
        const everything: FileEdits = new Map();
        for (const f of others) everything.set(f.uri.toString(), { uri: f.uri, spans: [...classTokenSpans(f.text, r.old, bem), ...jsSpans(f.text)] });
        for (const f of scripts.values()) everything.set(f.uri.toString(), { uri: f.uri, spans: jsSpans(f.text) });
        for (const f of styles.values()) everything.set(f.uri.toString(), { uri: f.uri, spans: selectorSpans(f.text, r.old, bem) });
        if (files.size) await this.apply(files, r.old, r.new, `clase «${r.old}» → «${r.new}» (este archivo)`);
        const pick = await vscode.window.showInformationMessage(
          `GhostCode: la clase «${r.old}» también la usan ${others.length} archivo(s) y las hojas de estilo. ¿Renombrar ahí también?`,
          "Renombrar en todos",
        );
        if (pick) await this.apply(everything, r.old, r.new, `clase «${r.old}» → «${r.new}» en todo el proyecto`, true);
        return;
      }
    } else {
      // Cambio en una hoja de estilos: las demás hojas y todo el marcado que usa la clase.
      add(doc.uri, selectorSpans(doc.getText(), r.old, bem));
      for (const f of styles.values()) if (f.uri.toString() !== here) add(f.uri, selectorSpans(f.text, r.old, bem));
      for (const f of markup.values()) {
        add(f.uri, classTokenSpans(f.text, r.old, bem));
        add(f.uri, inlineStyles(f.text));
        add(f.uri, jsSpans(f.text));
      }
      for (const f of scripts.values()) add(f.uri, jsSpans(f.text));
    }
    if (!files.size) return;
    if (files.size > 25) {
      const ok = await vscode.window.showWarningMessage(`GhostCode: renombrar «${r.old}» tocaría ${files.size} archivos. ¿Continuar?`, "Continuar");
      if (!ok) return;
    }
    await this.apply(files, r.old, r.new, `clase «${r.old}» → «${r.new}»`);
  }

  /** Archivos de marcado y de estilos del proyecto (abiertos primero, con su texto sin guardar). */
  private async projectFiles(doc: vscode.TextDocument) {
    const markup = new Map<string, { uri: vscode.Uri; text: string }>();
    const styles = new Map<string, { uri: vscode.Uri; text: string }>();
    const scripts = new Map<string, { uri: vscode.Uri; text: string }>();
    const read = async (uri: vscode.Uri) => {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (open) return open.getText();
      const bytes = await vscode.workspace.fs.readFile(uri);
      return bytes.byteLength > MAX_TEXT ? "" : Buffer.from(bytes).toString("utf8");
    };
    const [m, s, j] = await Promise.all([
      vscode.workspace.findFiles(MARKUP_GLOB, EXCLUDE, MAX_FILES),
      vscode.workspace.findFiles(STYLE_GLOB, `${EXCLUDE},**/*.min.css`, MAX_FILES),
      vscode.workspace.findFiles(SCRIPT_GLOB, `${EXCLUDE},**/*.min.js`, MAX_FILES),
    ]);
    const isStyle = STYLE_LANGS.has(doc.languageId);
    for (const uri of m) if (!(uri.toString() === doc.uri.toString())) markup.set(uri.toString(), { uri, text: await read(uri) });
    for (const uri of s) if (!(isStyle && uri.toString() === doc.uri.toString())) styles.set(uri.toString(), { uri, text: await read(uri) });
    for (const uri of j) if (uri.toString() !== doc.uri.toString()) scripts.set(uri.toString(), { uri, text: await read(uri) });
    return { markup, styles, scripts };
  }

  // --- Aplicar y deshacer ------------------------------------------------------------------

  private async apply(files: FileEdits, old: string, nu: string, label: string, quiet = false): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const inverse = new vscode.WorkspaceEdit();
    let count = 0;
    for (const { uri, spans } of files.values()) {
      const d = await vscode.workspace.openTextDocument(uri);
      const sorted = [...spans].sort((a, b) => a.start - b.start);
      let shift = 0;
      for (const s of sorted) {
        edit.replace(uri, new vscode.Range(d.positionAt(s.start), d.positionAt(s.end)), nu);
        inverse.replace(uri, new vscode.Range(d.positionAt(s.start + shift), d.positionAt(s.start + shift + nu.length)), old);
        shift += nu.length - old.length;
        count++;
      }
    }
    this.applying = true;
    try {
      if (!(await vscode.workspace.applyEdit(edit))) return;
      for (const d of vscode.workspace.textDocuments) this.remember(d);
    } finally {
      this.applying = false;
    }
    this.log.info(`Renombrado en vivo: ${label} (${count} cambio(s) en ${files.size} archivo(s)).`);
    if (quiet) void vscode.window.setStatusBarMessage(`$(check) GhostCode: ${label}`, 6000);
    else {
      void vscode.window
        .showInformationMessage(`GhostCode: ${label} — ${count} cambio(s) en ${files.size} archivo(s).`, "Deshacer")
        .then(async (pick) => {
          if (pick !== "Deshacer") return;
          this.applying = true;
          try {
            await vscode.workspace.applyEdit(inverse);
            for (const d of vscode.workspace.textDocuments) this.remember(d);
          } finally {
            this.applying = false;
          }
        });
    }
  }
}

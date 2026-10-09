import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { explainRequest, firstSentences, formatAnnotation, LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import type { ChatRequest } from "./core/types";
import { literalAt, literalRequest, type LiteralKind } from "./core/literals";
import type { ProjectIndex } from "./projectIndex";
import { findDefinition, KINDS, type Target } from "./symbols";
import { chatBackend } from "./tools";

const MAX_CODE = 8000;
const CACHE_SIZE = 300;


/** Datos que necesita «Insertar como comentario» desde el hover. */
export interface ExplanationRef {
  uri: string;
  line: number;
  lines: string[];
}

/**
 * Al pasar el puntero muestra una explicación generada por la IA de:
 *  - una consulta SQL o una expresión regular (dentro de cadenas o literales);
 *  - una función, método o clase (su declaración o un uso, aunque esté en otro archivo).
 * Cada explicación se genera una vez y se guarda en caché según el código explicado.
 */
export class ExplainHoverProvider implements vscode.HoverProvider {
  private readonly cache = new Map<string, string[]>();
  private readonly pending = new Map<string, Promise<string[] | undefined | null>>();
  private inflight?: { key: string; abort: AbortController };

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly getMode: () => Exclude<Mode, "off">,
    private readonly log: vscode.LogOutputChannel,
    private readonly project?: ProjectIndex,
  ) {}

  clearCache(): void {
    this.cache.clear();
  }

  async provideHover(doc: vscode.TextDocument, pos: vscode.Position, token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
    if (!cfg().hoverExplain || cfg().disabledLanguages.includes(doc.languageId)) return;
    const lang = resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env);

    // 1. SQL o regex bajo el puntero.
    const lit = literalAt(doc.getText().split(/\r?\n/), pos.line, pos.character, doc.languageId);
    if (lit) {
      const lines = await this.explain(`${lit.kind}\0${lit.text}`, literalRequest(lit.kind, lit.text, doc.languageId, lang, LANGUAGE_NAMES), token, lit.kind === "regex" ? 6 : 3);
      if (lines === null) return this.hint(doc.getWordRangeAtPosition(pos));
      if (!lines || token.isCancellationRequested) return;
      return new vscode.Hover(this.renderLiteral(lit.kind, lines));
    }

    // 2. Función, método o clase.
    const word = doc.getWordRangeAtPosition(pos);
    if (!word) return;
    const target = await findDefinition(doc, pos, doc.getText(word), this.project);
    if (!target || token.isCancellationRequested) return;
    const { symbol } = target;
    const kind = KINDS.get(symbol.kind) ?? "function";
    const code = target.doc.getText(symbol.range).slice(0, MAX_CODE);
    const req = explainRequest(code, kind, symbol.name, target.doc.languageId, vscode.workspace.asRelativePath(target.doc.uri), lang);
    const lines = await this.explain(`${target.doc.languageId}\0${kind}\0${code}`, req, token, 3);
    if (lines === null) return this.hint(word);
    if (!lines || token.isCancellationRequested) return;
    return new vscode.Hover(this.renderSymbol(symbol, kind, lines, target), word);
  }

  /**
   * Explicación (de la caché o del modelo). undefined si se canceló o falló; null si
   * no hay modelo instruct disponible.
   */
  private async explain(cacheKey: string, req: ChatRequest, token: vscode.CancellationToken, sentences: number): Promise<string[] | undefined | null> {
    const key = createHash("sha1").update(cacheKey).digest("hex");
    const cached = this.cache.get(key);
    if (cached) return cached;
    // La misma explicación pedida dos veces a la vez (VS Code puede repetir el hover): compartirla.
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.generate(key, req, sentences).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    const result = await pending;
    return token.isCancellationRequested ? undefined : result;
  }

  private async generate(key: string, req: ChatRequest, sentences: number): Promise<string[] | undefined | null> {
    const backend = await chatBackend(this.secrets, this.getMode(), false);
    if (!backend) return null;
    // Solo una explicación en curso: si el puntero pasó a otra cosa, la anterior ya no se mira.
    if (this.inflight && this.inflight.key !== key) this.inflight.abort.abort();
    const abort = new AbortController();
    this.inflight = { key, abort };
    const timer = setTimeout(() => abort.abort(), 60_000);
    let raw = "";
    try {
      for await (const piece of backend.chat(req, abort.signal)) raw += piece;
    } catch (err) {
      if (!abort.signal.aborted) this.log.warn(`Explicación: ${(err as Error).message}`);
      return undefined;
    } finally {
      clearTimeout(timer);
      if (this.inflight?.abort === abort) this.inflight = undefined;
    }
    // Primero limpiar (``` y marcadores de comentario, que van por líneas) y luego recortar.
    const clean = formatAnnotation(raw, Infinity, 50);
    const lines = sentences === 3 ? formatAnnotation(firstSentences(clean.join(" "), 3), 90, 8) : clean.slice(0, sentences);
    if (!lines.length) return undefined;
    if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, lines);
    return lines;
  }

  private renderLiteral(kind: LiteralKind, lines: string[]): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(kind === "sql" ? "$(database) **GhostCode** · consulta SQL\n\n" : "$(regex) **GhostCode** · expresión regular\n\n");
    if (kind === "sql") md.appendMarkdown(escapeMarkdown(lines.join(" ")));
    else {
      // Primera línea: qué reconoce; el resto: «parte — significado».
      md.appendMarkdown(escapeMarkdown(lines[0]));
      const parts = lines.slice(1).map((l) => {
        const [part, ...rest] = l.split(/\s+[—–-]\s+/);
        return rest.length ? `- \`${part.replace(/`/g, "")}\` — ${escapeMarkdown(rest.join(" — "))}` : `- ${escapeMarkdown(l)}`;
      });
      if (parts.length) md.appendMarkdown("\n\n" + parts.join("\n"));
    }
    return md;
  }

  private renderSymbol(symbol: vscode.DocumentSymbol, kind: string, lines: string[], target: Target): vscode.MarkdownString {
    const ref: ExplanationRef = { uri: target.doc.uri.toString(), line: symbol.range.start.line, lines };
    const insert = `command:ghostcode.insertExplanation?${encodeURIComponent(JSON.stringify([ref]))}`;
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ["ghostcode.insertExplanation", "workbench.view.extension.ghostcode"] };
    md.appendMarkdown(`$(sparkle) **GhostCode** · ${kind} \`${symbol.name.replace(/`/g, "")}\`\n\n`);
    // appendText cambia los espacios por &nbsp; y la ventana no haría saltos de línea.
    md.appendMarkdown(escapeMarkdown(lines.join(" ")));
    md.appendMarkdown(`\n\n[$(comment) Insertar como comentario](${insert} "Añade esta explicación encima de la definición")`);
    return md;
  }

  /** Sin modelo instruct en local: explicar cómo activarlo en lugar de no mostrar nada. */
  private hint(word: vscode.Range | undefined): vscode.Hover {
    const md = new vscode.MarkdownString(
      "$(sparkle) **GhostCode**: para explicar código al pasar el puntero instala un modelo *instruct* " +
        "desde [el panel de GhostCode](command:workbench.view.extension.ghostcode) (Modelos sugeridos → Herramientas).",
      true,
    );
    md.isTrusted = { enabledCommands: ["workbench.view.extension.ghostcode"] };
    return new vscode.Hover(md, word);
  }
}

/** Escapa Markdown (y los iconos `$(…)`) sin tocar los espacios. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>$~]/g, "\\$&");
}

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { extractDeclarations } from "./core/declarations";
import { tokenSet, jaccard } from "./core/neighbors";
import { familyOf } from "./core/projectContext";
import { analyzeStyle, describeStyle, haloSummaryRequest, styleHint, type SourceFile, type StyleProfile } from "./core/style";
import type { Snippet } from "./core/types";
import { chatBackend } from "./tools";

const SOURCE_EXT = /\.(m?[jt]sx?|cjs|vue|svelte|php|py|rb|go|rs|java|kts?|scala|swift|c|h|cc|cpp|hpp|cs|dart|lua|exs?|sql|sh)$/i;
const SKIP_DIRS = new Set(["node_modules", "vendor", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt", "target", "__pycache__", ".venv", "venv", "Pods", ".gradle", "bower_components"]);
const MAX_FILES = 1500;
const MAX_BYTES = 300_000;
const MAX_EXAMPLES = 4000;
const EXT_BY_LANGUAGE: Record<string, string> = {
  javascript: "js", javascriptreact: "jsx", typescript: "ts", typescriptreact: "tsx", python: "py", ruby: "rb",
  rust: "rs", csharp: "cs", cpp: "cpp", kotlin: "kt", shellscript: "sh", elixir: "ex",
};

interface Example {
  path: string;
  family: string;
  text: string;
  tokens: Set<string>;
}

export interface HaloSource {
  id: string;
  /** Lo que escribió el usuario (ruta o URL). */
  input: string;
  name: string;
  root: string;
  cloned: boolean;
  files: number;
  functions: number;
  profile: StyleProfile;
  styleTags: string[];
  /** Resumen del modelo (viñetas), si había modelo disponible. */
  summary?: string;
  analyzedAt: number;
  examples: Example[];
}

const isUrl = (s: string) => /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(s.trim());

/**
 * «Halo IA»: analiza un proyecto del usuario (carpeta o repositorio) y guarda en memoria,
 * mientras VS Code esté abierto, cómo escribe: su estilo medido, un resumen del modelo
 * y sus funciones como ejemplos. El autocompletado y las herramientas lo usan como
 * referencia, en modo Local o API.
 */
export class HaloService implements vscode.Disposable {
  private readonly sources: HaloSource[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  /** Una vez pulsado «Guardar temporal», el análisis se mantiene en disco hasta «Limpiar». */
  private persisted = false;

  constructor(
    private readonly storageDir: string,
    private readonly secrets: vscode.SecretStorage,
    private readonly getMode: () => Exclude<Mode, "off">,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  list(): Omit<HaloSource, "examples">[] {
    return this.sources.map(({ examples: _examples, ...rest }) => rest);
  }

  get isPersisted(): boolean {
    return this.persisted;
  }

  private get storeFile(): string {
    return join(this.storageDir, "halo-cache.json");
  }

  /** Recupera el análisis guardado con «Guardar temporal» (si existe) al abrir VS Code. */
  async restore(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.storeFile, "utf8")) as { version: number; sources: (Omit<HaloSource, "examples"> & { examples: Omit<Example, "tokens">[] })[] };
      if (data.version !== 1 || !Array.isArray(data.sources)) return;
      for (const s of data.sources) {
        this.sources.push({ ...s, cloned: false, examples: s.examples.map((e) => ({ ...e, tokens: tokenSet(e.text) })) });
      }
      this.persisted = true;
      this.changed.fire();
      this.log.info(`Halo IA: caché guardada recuperada (${this.sources.length} fuente(s)).`);
    } catch {
      /* sin caché guardada */
    }
  }

  /** «Guardar temporal»: conserva el análisis en disco entre sesiones hasta que se pulse «Limpiar». */
  async save(): Promise<void> {
    if (!this.sources.length) {
      void vscode.window.showInformationMessage("GhostCode: analiza primero una carpeta o repositorio para poder guardarlo.");
      return;
    }
    this.persisted = true;
    await this.writeStore();
    // Los clones ya no hacen falta: los ejemplos quedan en la caché guardada.
    for (const s of this.sources) {
      if (s.cloned) await rm(s.root, { recursive: true, force: true }).catch(() => undefined);
      s.cloned = false;
    }
    this.changed.fire();
    void vscode.window.showInformationMessage("GhostCode Halo IA: análisis guardado. Se conservará al reabrir VS Code hasta que pulses «Limpiar».");
  }

  /** «Limpiar»: borra todo el análisis, también el guardado en disco. */
  async clear(): Promise<void> {
    for (const s of this.sources.splice(0)) if (s.cloned) await rm(s.root, { recursive: true, force: true }).catch(() => undefined);
    this.persisted = false;
    await rm(this.storeFile, { force: true }).catch(() => undefined);
    this.changed.fire();
  }

  private async writeStore(): Promise<void> {
    if (!this.persisted) return;
    try {
      await mkdir(this.storageDir, { recursive: true });
      const sources = this.sources.map((s) => ({ ...s, examples: s.examples.map(({ tokens: _t, ...e }) => e) }));
      await writeFile(this.storeFile, JSON.stringify({ version: 1, sources }), "utf8");
    } catch (err) {
      this.log.warn(`Halo IA: no se pudo guardar la caché: ${(err as Error).message}`);
    }
  }

  get active(): boolean {
    return cfg().haloEnabled && this.sources.length > 0;
  }

  async analyze(input: string): Promise<HaloSource | undefined> {
    const raw = input.trim();
    if (!raw) {
      void vscode.window.showInformationMessage("GhostCode: escribe la ruta de una carpeta o la URL de un repositorio.");
      return undefined;
    }
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Halo IA", cancellable: false },
      async (progress) => {
        let root: string;
        let cloned = false;
        try {
          if (isUrl(raw)) {
            progress.report({ message: "clonando el repositorio…" });
            root = await mkdtemp(join(tmpdir(), "ghostcode-halo-"));
            cloned = true;
            await run("git", ["clone", "--depth", "1", "--quiet", raw, root], 300_000);
          } else {
            const expanded = raw.replace(/^~(?=$|\/)/, homedir());
            const base = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
            root = isAbsolute(expanded) ? expanded : resolve(base, expanded);
            if (!(await stat(root).catch(() => undefined))?.isDirectory()) throw new Error(`no existe la carpeta ${root}`);
          }
        } catch (err) {
          void vscode.window.showErrorMessage(`GhostCode Halo IA: ${(err as Error).message}`);
          return undefined;
        }

        progress.report({ message: "leyendo el código…" });
        const files = await collect(root);
        if (!files.length) {
          void vscode.window.showWarningMessage(`GhostCode Halo IA: no se encontró código fuente en ${root}.`);
          if (cloned) await rm(root, { recursive: true, force: true });
          return undefined;
        }
        progress.report({ message: `analizando ${files.length} archivos…` });
        const profile = analyzeStyle(files);
        const examples = extractExamples(files);

        const source: HaloSource = {
          id: `${Date.now()}`,
          input: raw,
          name: isUrl(raw) ? raw.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/") : basename(root),
          root,
          cloned,
          files: files.length,
          functions: profile.functions,
          profile,
          styleTags: describeStyle(profile),
          analyzedAt: Date.now(),
          examples,
        };

        // Resumen de hábitos por el modelo (opcional: sin modelo instruct se queda el perfil medido).
        progress.report({ message: "el modelo está estudiando cómo escribes…" });
        source.summary = await this.summarize(examples, profile);

        // Reemplazar un análisis anterior de la misma fuente.
        const old = this.sources.findIndex((s) => s.root === root || s.input === raw);
        if (old >= 0) await this.remove(this.sources[old].id, false);
        this.sources.push(source);
        await this.writeStore();
        this.changed.fire();
        this.log.info(`Halo IA: ${source.name} · ${files.length} archivos · ${examples.length} ejemplos · ${styleHint(profile)}`);
        vscode.window.setStatusBarMessage(`$(sparkle) Halo IA: ${source.name} analizado (${files.length} archivos)`, 6000);
        return source;
      },
    );
  }

  private async summarize(examples: Example[], profile: StyleProfile): Promise<string | undefined> {
    const backend = await chatBackend(this.secrets, this.getMode(), false);
    if (!backend) return undefined;
    // Muestras variadas: funciones de tamaño medio de archivos distintos.
    const byFile = new Map<string, Example>();
    for (const e of [...examples].sort((a, b) => Math.abs(a.text.length - 600) - Math.abs(b.text.length - 600))) {
      if (!byFile.has(e.path)) byFile.set(e.path, e);
      if (byFile.size >= 6) break;
    }
    const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";
    const abort = AbortSignal.timeout(120_000);
    let raw = "";
    try {
      for await (const piece of backend.chat(haloSummaryRequest([...byFile.values()].map((e) => e.text), styleHint(profile), lang), abort)) raw += piece;
    } catch (err) {
      this.log.warn(`Halo IA: no se pudo resumir el estilo: ${(err as Error).message}`);
      return undefined;
    }
    const bullets = raw.split("\n").map((l) => l.trim()).filter((l) => /^[-*•]\s/.test(l)).map((l) => "- " + l.replace(/^[-*•]\s*/, ""));
    return bullets.length ? bullets.slice(0, 8).join("\n") : raw.trim().slice(0, 800) || undefined;
  }

  async remove(id: string, notify = true): Promise<void> {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [s] = this.sources.splice(i, 1);
    if (s.cloned) await rm(s.root, { recursive: true, force: true }).catch(() => undefined);
    await this.writeStore();
    if (notify) this.changed.fire();
  }

  /** Funciones del usuario parecidas a lo que está escribiendo (mismo lenguaje). */
  snippets(textBeforeCursor: string, languagePath: string, languageId = "", maxSnippets = 2): Snippet[] {
    if (!this.active) return [];
    const target = tokenSet(textBeforeCursor.split("\n").slice(-20).join("\n"));
    if (target.size < 3) return [];
    // Documentos sin guardar no tienen extensión: usar el lenguaje de VS Code.
    const ext = extname(languagePath).slice(1).toLowerCase() || (EXT_BY_LANGUAGE[languageId] ?? languageId);
    const fam = familyOf(ext);
    const scored: Snippet[] = [];
    for (const s of this.sources) {
      for (const e of s.examples) {
        if (e.family !== fam) continue;
        const score = jaccard(target, e.tokens);
        if (score >= 0.18) scored.push({ path: `Halo IA · ${s.name}/${e.path}`, text: e.text, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, maxSnippets);
  }

  /** Estilo medido (línea en inglés) del análisis más reciente, para la cabecera del prompt. */
  styleLine(): string | undefined {
    if (!this.active) return undefined;
    return styleHint(this.sources[this.sources.length - 1].profile);
  }

  /** Estilo + resumen del modelo, para las herramientas de chat (documentar, arreglar, prompts…). */
  chatContext(): string | undefined {
    if (!this.active) return undefined;
    const s = this.sources[this.sources.length - 1];
    return `The developer's coding style (follow it): ${styleHint(s.profile)}.${s.summary ? `\nTheir habits:\n${s.summary}` : ""}`;
  }

  dispose(): void {
    // Caché temporal: los repositorios clonados se borran al cerrar VS Code.
    for (const s of this.sources) if (s.cloned) void rm(s.root, { recursive: true, force: true }).catch(() => undefined);
    this.changed.dispose();
  }
}

function run(cmd: string, args: string[], timeout: number): Promise<void> {
  return new Promise((ok, fail) =>
    execFile(cmd, args, { timeout }, (err, _stdout, stderr) => (err ? fail(new Error(stderr.trim() || err.message)) : ok())),
  );
}

async function collect(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(full);
      } else if (e.isFile() && SOURCE_EXT.test(e.name) && !/\.min\.\w+$/.test(e.name)) {
        const st = await stat(full).catch(() => undefined);
        if (!st || st.size > MAX_BYTES) continue;
        out.push({ path: relative(root, full).split("\\").join("/"), text: await readFile(full, "utf8").catch(() => "") });
      }
    }
  };
  await walk(root);
  return out.filter((f) => f.text);
}

/** Las funciones del usuario (3–60 líneas) como ejemplos de cómo escribe. */
function extractExamples(files: SourceFile[]): Example[] {
  const out: Example[] = [];
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    const family = familyOf(extname(f.path).slice(1).toLowerCase());
    for (const d of extractDeclarations(f.text)) {
      if (d.kind !== "function" || d.end === undefined) continue;
      const n = d.end - d.line + 1;
      if (n < 3 || n > 60) continue;
      const text = lines.slice(d.line, d.end + 1).join("\n");
      if (text.length > 1500) continue;
      out.push({ path: f.path, family, text, tokens: tokenSet(text) });
      if (out.length >= MAX_EXAMPLES) return out;
    }
  }
  return out;
}

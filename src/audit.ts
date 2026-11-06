import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  parseComposerAudit,
  parseComposerOutdated,
  parseNpmAudit,
  parseNpmOutdated,
  parsePipAudit,
  summarizeAudit,
  type AuditItem,
  type AuditSummary,
  type OutdatedItem,
} from "./core/audit";
import { chatBackend, runChat } from "./tools";
import type { Mode } from "./config";
import type { WorkspaceFiles } from "./workspaceFiles";

const run = promisify(execFile);

export interface AuditState {
  busy: boolean;
  provider?: string;
  at?: number;
  items: AuditItem[];
  summary?: AuditSummary;
  outdated: OutdatedItem[];
  error?: string;
}

/**
 * Ejecuta la auditoría de dependencias del ecosistema detectado. Nunca instala
 * ni actualiza nada: solo lee el informe de la herramienta oficial.
 */
export class AuditService {
  private result: AuditState = { busy: false, items: [], outdated: [] };

  constructor(
    private readonly files: WorkspaceFiles,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  state(): AuditState {
    return this.result;
  }

  async scan(): Promise<AuditState> {
    if (this.result.busy) return this.result;
    this.result = { ...this.result, busy: true, error: undefined };
    try {
      const root = vscode.workspace.workspaceFolders?.[0];
      if (!root) {
        this.result = { busy: false, items: [], outdated: [], error: "Abre una carpeta para revisar sus dependencias." };
        return this.result;
      }
      const list = await this.files.list();
      const has = (name: string) => list.has(name);
      let provider: string;
      let items: AuditItem[];
      let outdated: OutdatedItem[] = [];
      if (has("composer.lock")) {
        provider = "Composer";
        items = parseComposerAudit(await auditJson("composer", ["audit", "--format=json"], root.uri.fsPath, "Composer"));
        outdated = parseComposerOutdated(await rawJson("composer", ["outdated", "--format=json", "--direct"], root.uri.fsPath));
      } else if (has("pnpm-lock.yaml")) {
        provider = "pnpm";
        items = parseNpmAudit(await auditJson("pnpm", ["audit", "--json"], root.uri.fsPath, "pnpm"));
        outdated = parseNpmOutdated(await rawJson("pnpm", ["outdated", "--json"], root.uri.fsPath));
      } else if (has("yarn.lock")) {
        provider = "Yarn";
        items = parseNpmAudit(await auditJson("yarn", ["npm", "audit", "--json"], root.uri.fsPath, "Yarn"));
        outdated = parseNpmOutdated(await rawJson("yarn", ["outdated", "--json"], root.uri.fsPath));
      } else if (has("package.json")) {
        provider = "npm";
        items = parseNpmAudit(await auditJson("npm", ["audit", "--json", "--audit-level=low"], root.uri.fsPath, "npm"));
        outdated = parseNpmOutdated(await rawJson("npm", ["outdated", "--json"], root.uri.fsPath));
      } else if (has("requirements.txt") || has("pyproject.toml")) {
        provider = "pip-audit";
        items = parsePipAudit(await auditJson("pip-audit", ["-f", "json"], root.uri.fsPath, "pip-audit"));
      } else {
        this.result = { busy: false, items: [], outdated: [], error: "No encontré package.json, composer.lock, requirements.txt ni pyproject.toml." };
        return this.result;
      }
      this.result = { busy: false, provider, at: Date.now(), items, summary: summarizeAudit(items), outdated };
      this.log.info(`Auditoría ${provider}: ${items.length} hallazgo(s)`);
    } catch (err) {
      this.result = { ...this.result, busy: false, error: (err as Error).message };
    }
    return this.result;
  }

  async explain(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<void> {
    const state = this.result;
    if (!state.items.length) {
      void vscode.window.showInformationMessage("GhostCode: primero ejecuta la revisión de dependencias.");
      return;
    }
    let backend;
    try {
      backend = await chatBackend(secrets, mode);
    } catch (err) {
      void vscode.window.showErrorMessage(`GhostCode: ${(err as Error).message}`);
      return;
    }
    if (!backend) return;
    const summary = state.summary;
    const list = state.items
      .slice(0, 40)
      .map((i) => `- [${i.severity}] ${i.package}${i.version ? ` (${i.version})` : ""}: ${i.title}${i.fixed ? ` → corregir en ${i.fixed}` : ""}`)
      .join("\n");
    const outdated = (state.outdated ?? [])
      .slice(0, 20)
      .map((o) => `- ${o.package}: ${o.current ?? "?"} → ${o.latest ?? "?"}`)
      .join("\n");
    const reply = await runChat(
      backend,
      {
        system: [
          "You are a dependency security reviewer. You receive an audit report of a project.",
          "Write in the user's language: (1) an executive summary in 2-3 sentences, (2) the 5 most urgent packages",
          "in a table with severity, risk and the minimum safe action, (3) an ordered remediation plan,",
          "(4) what can wait. Be concrete and do not invent CVEs that are not in the report.",
        ].join("\n"),
        user: `Provider: ${state.provider}\nSummary: ${JSON.stringify(summary)}\n\nVulnerabilities:\n${list}\n\nOutdated:\n${outdated || "(none detected)"}`,
        maxTokens: 1200,
        temperature: 0.2,
      },
      "explicando la auditoría",
      log,
    );
    if (!reply) return;
    const doc = await vscode.workspace.openTextDocument({ content: `# Auditoría de dependencias\n\n${reply}`, language: "markdown" });
    await vscode.window.showTextDocument(doc, { preview: true });
  }
}

async function exec(cmd: string, args: string[], cwd: string): Promise<{ stdout: string }> {
  const { stdout } = await run(cmd, args, { cwd, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 });
  return { stdout: String(stdout ?? "") };
}

async function auditJson(cmd: string, args: string[], cwd: string, label: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, cwd);
    if (!stdout.trim()) throw new Error("no devolvió ningún informe");
    return stdout;
  } catch (err) {
    const stdout = String((err as { stdout?: string }).stdout ?? "");
    if (stdout.trim()) return stdout;
    const detail = (err as Error).message;
    throw new Error(`${label}: ${detail}. Comprueba que ${cmd} está instalado y que el proyecto tiene dependencias instaladas.`);
  }
}

/** Para comandos que salen con código 1 cuando hay resultados (outdated). */
async function rawJson(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, cwd);
    return stdout;
  } catch (err) {
    return String((err as { stdout?: string }).stdout ?? "");
  }
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { projectHealth, type HealthItem } from "./core/projectHealth";
import type { WorkspaceFiles } from "./workspaceFiles";

const run = promisify(execFile);
const SOURCE = /\.(m?[jt]sx?|cjs|vue|svelte|php|py|rb|go|rs|java|kt|cs|c|h|cc|cpp|hpp|lua|sh)$/i;

export interface DoctorState {
  busy: boolean;
  at?: number;
  items: HealthItem[];
  versions: { node: string; php?: string; python?: string };
  files: number;
  error?: string;
}

/**
 * Comprueba el entorno del proyecto (versiones, lockfiles, dependencias y
 * variables de entorno) sin IA. Se cachea un minuto para no repetir lecturas.
 */
export class ProjectDoctor {
  private result?: DoctorState;
  private last = 0;

  constructor(
    private readonly files: WorkspaceFiles,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  state(): DoctorState {
    return (
      this.result ?? {
        busy: false,
        items: [],
        versions: { node: process.version },
        files: 0,
      }
    );
  }

  async check(force = false): Promise<DoctorState> {
    if (this.result?.busy) return this.result;
    if (!force && this.result && Date.now() - this.last < 60_000) return this.result;
    this.result = { ...this.state(), busy: true };
    try {
      const root = vscode.workspace.workspaceFolders?.[0];
      if (!root) {
        this.result = { busy: false, items: [], versions: { node: process.version }, files: 0, error: "Abre una carpeta para revisarla." };
        return this.result;
      }
      const list = [...(await this.files.list())];
      const opaque = await this.files.opaqueDirs();
      const read = async (name: string, max = 300_000): Promise<string | undefined> => {
        try {
          const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(root.uri, name));
          if (stat.size > max) return undefined;
          return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root.uri, name)));
        } catch {
          return undefined;
        }
      };

      const [packageJson, composerJson, env, envExample, nvmrc, gitignore, phpVersion, pythonVersion] = await Promise.all([
        read("package.json"),
        read("composer.json"),
        read(".env"),
        read(".env.example"),
        read(".nvmrc", 1000),
        read(".gitignore"),
        version("php", ["-v"], /PHP\s+([\d.]+)/),
        version("python3", ["--version"], /Python\s+([\d.]+)/),
      ]);

      // Solo se leen los primeros archivos de código para buscar variables de entorno.
      const sourceTexts: Record<string, string> = {};
      for (const path of list.filter((p) => SOURCE.test(p) && !/(^|\/)(node_modules|vendor|dist|build)\//.test(p)).slice(0, 500)) {
        const text = await read(path, 200_000);
        if (text && /env|ENV|getenv/.test(text)) sourceTexts[path] = text;
      }

      const items = projectHealth({
        files: [...list, ...opaque.map((d) => `${d}/`)],
        packageJson,
        composerJson,
        env,
        envExample,
        nvmrc,
        gitignore,
        sourceTexts,
        nodeVersion: process.version,
        phpVersion,
        pythonVersion,
      });
      this.result = {
        busy: false,
        at: Date.now(),
        items,
        versions: { node: process.version, php: phpVersion, python: pythonVersion },
        files: list.length,
      };
      this.last = Date.now();
    } catch (err) {
      this.result = { ...this.state(), busy: false, error: (err as Error).message };
      this.log.warn(`Doctor: ${(err as Error).message}`);
    }
    return this.result;
  }
}

async function version(cmd: string, args: string[], re: RegExp): Promise<string | undefined> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 2500 });
    return re.exec(stdout ?? "")?.[1];
  } catch {
    return undefined;
  }
}

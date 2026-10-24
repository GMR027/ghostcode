import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseModelList, parseRunOutput } from "../core/opencode";
import { chatSystemPrompt, chatUserPrompt } from "../core/prompt";
import { BackendError, type Backend, type ChatRequest, type CompletionRequest } from "../core/types";

/** Ruta del CLI: el PATH de VS Code a veces no incluye ~/.opencode/bin. */
export function opencodeBin(): string | undefined {
  const home = join(homedir(), ".opencode", "bin", "opencode");
  if (existsSync(home)) return home;
  for (const dir of (process.env.PATH ?? "").split(":")) {
    const p = join(dir, "opencode");
    if (dir && existsSync(p)) return p;
  }
  return undefined;
}

function run(bin: string, args: string[], ms: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // cwd = carpeta temporal: el agente no debe tocar ningún proyecto, todo el contexto va en el mensaje.
    const p = spawn(bin, args, { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"], signal, timeout: ms });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 || out ? resolve(out) : reject(new Error(err.trim() || `opencode terminó con código ${code}`))));
  });
}

/** Modelos disponibles para el usuario (gratis, suscripción y los de su cuenta). Vacío si no hay CLI. */
export async function listOpencodeModels(): Promise<string[]> {
  const bin = opencodeBin();
  if (!bin) return [];
  const out = await run(bin, ["models", "--standalone"], 20_000).catch(() => "");
  return parseModelList(out);
}

async function ask(model: string, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const bin = opencodeBin();
  if (!bin) throw new BackendError("OpenCode no está instalado (no se encontró el comando «opencode»).", "connection");
  const args = ["run", "--format", "json"];
  if (model) args.push("-m", model);
  args.push(`${system}\n\n${user}`);
  try {
    return parseRunOutput(await run(bin, args, 300_000, signal));
  } catch (err) {
    if (err instanceof BackendError || signal?.aborted) throw err;
    throw new BackendError(`OpenCode: ${(err as Error).message}`);
  }
}

/** Modo API con OpenCode: usa las credenciales y los modelos que el usuario configuró con `opencode auth login`. */
export class OpencodeBackend implements Backend {
  readonly id: string;
  readonly label: string;
  readonly isChat = true;

  constructor(private readonly model: string) {
    this.id = `opencode:${model || "default"}`;
    this.label = `OpenCode · ${model || "predeterminado"}`;
  }

  async *complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    yield await ask(this.model, chatSystemPrompt(req.multiline), chatUserPrompt(req), signal);
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    yield await ask(this.model, req.system, req.user, signal);
  }
}

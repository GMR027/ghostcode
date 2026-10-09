import { buildFimPrompt } from "../core/prompt";
import { BackendError, type Backend, type ChatRequest, type CompletionRequest } from "../core/types";
import { joinUrl, postJson, readLines } from "./http";

const NUM_CTX = 8192;

export interface OllamaModel {
  name: string;
  size: number;
}

/** Modo LOCAL: Ollama con fill-in-the-middle nativo (`suffix`). */
export class OllamaBackend implements Backend {
  readonly isChat = false;
  readonly id: string;
  readonly label: string;

  constructor(private readonly baseUrl: string, private readonly model: string) {
    this.id = `ollama:${model}`;
    this.label = `Local · ${model}`;
  }

  async *complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    const res = await this.post(
      "/api/generate",
      {
        model: this.model,
        prompt: buildFimPrompt(req),
        suffix: req.suffix,
        stream: true,
        keep_alive: "30m",
        options: {
          temperature: req.temperature,
          top_p: 0.9,
          num_predict: req.multiline ? req.maxTokens : Math.min(req.maxTokens, 96),
          num_ctx: NUM_CTX,
          stop: req.multiline ? ["\n\n\n\n"] : ["\n"],
        },
      },
      signal,
    );
    for await (const msg of readNdjson(res)) {
      if (msg.response) yield msg.response;
    }
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    const res = await this.post(
      "/api/chat",
      {
        model: this.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        stream: true,
        keep_alive: "30m",
        options: { temperature: req.temperature, num_predict: req.maxTokens, num_ctx: NUM_CTX },
      },
      signal,
    );
    for await (const msg of readNdjson(res)) {
      if (msg.message?.content) yield msg.message.content;
    }
  }

  private post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    return postJson(joinUrl(this.baseUrl, path), body, {}, signal, "Ollama").catch((err) => {
      if (err instanceof BackendError && err.kind === "model") {
        throw new BackendError(
          `Ollama no tiene el modelo "${this.model}". Ejecuta: ollama pull ${this.model}`,
          "model",
        );
      }
      if (err instanceof BackendError && err.kind === "connection") {
        throw new BackendError(
          `Ollama no responde en ${this.baseUrl}. ¿Está corriendo? (systemctl start ollama / ollama serve)`,
          "connection",
        );
      }
      throw err;
    });
  }

  /** Carga el modelo en memoria (GPU) para que la primera sugerencia sea rápida. */
  async warmUp(): Promise<void> {
    await fetch(joinUrl(this.baseUrl, "/api/generate"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Mismo num_ctx que las peticiones reales; si no, Ollama recarga el modelo en la primera.
      body: JSON.stringify({ model: this.model, prompt: "", keep_alive: "30m", options: { num_ctx: NUM_CTX } }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
  }

  static async listModels(baseUrl: string): Promise<OllamaModel[]> {
    const res = await fetch(joinUrl(baseUrl, "/api/tags"), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: OllamaModel[] };
    return data.models ?? [];
  }
}

/** Itera las líneas NDJSON de Ollama hasta `done`, lanzando sus errores. */
interface OllamaChunk {
  response?: string;
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

async function* readNdjson(res: Response): AsyncIterable<OllamaChunk> {
  for await (const line of readLines(res)) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line) as OllamaChunk;
    if (msg.error) throw new BackendError(`Ollama: ${msg.error}`);
    yield msg;
    if (msg.done) return;
  }
}

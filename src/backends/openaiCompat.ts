import { buildFimPrompt, chatSystemPrompt, chatUserPrompt } from "../core/prompt";
import { BackendError, type Backend, type ChatRequest, type CompletionRequest } from "../core/types";
import { joinUrl, postJson, readSse } from "./http";

export const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";

/** Servidores en los que ya sabemos que /completions con `suffix` no funciona. */
const fimUnsupported = new Set<string>();

/**
 * Modo API genérico compatible con OpenAI: OpenAI, DeepSeek, OpenRouter, Groq,
 * LM Studio, vLLM, llama.cpp server, etc. Intenta FIM (/completions + suffix) y
 * si el servidor no lo soporta cae a /chat/completions.
 */
export class OpenAICompatBackend implements Backend {
  readonly id: string;
  readonly label: string;
  private readonly fimKey: string;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly useFim: boolean,
  ) {
    this.id = `openai:${baseUrl}:${model}`;
    this.label = `API · ${model}`;
    this.fimKey = `${baseUrl}|${model}`;
    // La API oficial de OpenAI ya no ofrece FIM con modelos actuales.
    if (/api\.openai\.com/.test(baseUrl)) fimUnsupported.add(this.fimKey);
  }

  get isChat(): boolean {
    return !this.useFim || fimUnsupported.has(this.fimKey);
  }

  async *complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    this.requireModel();
    if (!this.isChat) {
      try {
        yield* this.completeFim(req, signal);
        return;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === undefined || ![400, 404, 405, 422, 501].includes(status)) throw err;
        fimUnsupported.add(this.fimKey);
      }
    }
    yield* this.completeChat(
      chatSystemPrompt(req.multiline),
      chatUserPrompt(req),
      req.multiline ? req.maxTokens * 4 : 512,
      signal,
    );
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    this.requireModel();
    yield* this.completeChat(req.system, req.user, req.maxTokens, signal);
  }

  private requireModel(): void {
    if (!this.model) {
      throw new BackendError("Falta el modelo. Ejecuta «GhostCode: Configurar proveedor API».", "model");
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {};
  }

  private async *completeFim(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    const res = await postJson(
      joinUrl(this.baseUrl, "/completions"),
      {
        model: this.model,
        prompt: buildFimPrompt(req),
        suffix: req.suffix,
        max_tokens: req.multiline ? req.maxTokens : Math.min(req.maxTokens, 96),
        temperature: req.temperature,
        stop: req.multiline ? undefined : ["\n"],
        stream: true,
      },
      this.headers(),
      signal,
      "API",
    );
    for await (const ev of readSse(res)) {
      const piece = ev?.choices?.[0]?.text;
      if (typeof piece === "string" && piece) yield piece;
    }
  }

  private async *completeChat(system: string, user: string, maxTokens: number, signal: AbortSignal): AsyncIterable<string> {
    const res = await postJson(
      joinUrl(this.baseUrl, "/chat/completions"),
      {
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        // OpenAI exige max_completion_tokens; el resto de servidores compatibles usa max_tokens.
        [/api\.openai\.com/.test(this.baseUrl) ? "max_completion_tokens" : "max_tokens"]: maxTokens,
        stream: true,
      },
      this.headers(),
      signal,
      "API",
    );
    for await (const ev of readSse(res)) {
      const piece = ev?.choices?.[0]?.delta?.content;
      if (typeof piece === "string" && piece) yield piece;
    }
  }
}

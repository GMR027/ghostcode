import Anthropic from "@anthropic-ai/sdk";
import { chatSystemPrompt, chatUserPrompt } from "../core/prompt";
import { BackendError, type Backend, type ChatRequest, type CompletionRequest } from "../core/types";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5";

/** Modelos sugeridos en el selector (el usuario puede escribir cualquier otro). */
export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5", detail: "Máxima calidad (recomendado)" },
  { id: "claude-sonnet-5", detail: "Equilibrio calidad / velocidad / costo" },
  { id: "claude-haiku-4-5", detail: "El más rápido y barato" },
];

// Modelos que admiten `output_config.effort` (Haiku 4.5 no).
const SUPPORTS_EFFORT = /^claude-(opus|sonnet|fable|mythos)-/;
// Modelos para los que se activa el respaldo automático del servidor ante rechazos.
const SUPPORTS_FALLBACK = /^claude-(opus-5|fable-5)/;

/** Modo API: Anthropic Claude vía Messages API (SDK oficial, streaming). */
export class AnthropicBackend implements Backend {
  readonly isChat = true;
  readonly id: string;
  readonly label: string;
  private client?: Anthropic;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model: string,
    private readonly baseUrl?: string,
  ) {
    this.id = `anthropic:${model}`;
    this.label = `Claude · ${model.replace(/^claude-/, "")}`;
  }

  private getClient(): Anthropic {
    // Sin apiKey el SDK usa ANTHROPIC_API_KEY o el perfil de `ant auth login`.
    this.client ??= new Anthropic({
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.baseUrl ? { baseURL: this.baseUrl } : {}),
      maxRetries: 0, // en autocompletado es mejor fallar rápido que reintentar
      timeout: 30_000,
    });
    return this.client;
  }

  async *complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    yield* this.stream(
      // El razonamiento (si lo hay) también cuenta contra max_tokens.
      req.multiline ? Math.max(4096, req.maxTokens * 8) : 2048,
      chatSystemPrompt(req.multiline),
      chatUserPrompt(req),
      signal,
    );
  }

  async *chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string> {
    yield* this.stream(Math.max(2048, req.maxTokens * 4), req.system, req.user, signal);
  }

  private async *stream(maxTokens: number, system: string, user: string, signal: AbortSignal): AsyncIterable<string> {
    const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      stream: true,
    };
    // Esfuerzo bajo = respuestas más rápidas, ideal para autocompletado.
    if (SUPPORTS_EFFORT.test(this.model)) params.output_config = { effort: "low" };
    if (SUPPORTS_FALLBACK.test(this.model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    try {
      const stream = this.getClient().beta.messages.stream(params, { signal });
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        } else if (event.type === "message_delta" && event.delta.stop_reason === "refusal") {
          return;
        }
      }
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw err;
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new BackendError("Claude: API key inválida o sin permisos.", "auth");
      }
      if (err instanceof Anthropic.NotFoundError) {
        throw new BackendError(`Claude: el modelo "${this.model}" no existe o no está disponible.`, "model");
      }
      if (err instanceof Anthropic.RateLimitError) {
        throw new BackendError("Claude: límite de uso alcanzado (429).", "rate-limit");
      }
      if (err instanceof Anthropic.APIConnectionError) {
        if (signal.aborted) throw err;
        throw new BackendError("Claude: no se pudo conectar con la API.", "connection");
      }
      if (err instanceof Anthropic.APIError) {
        if (/api[_ ]key|authentication/i.test(err.message)) {
          throw new BackendError("Claude: falta la API key. Usa «GhostCode: Guardar API key».", "auth");
        }
        throw new BackendError(`Claude: ${err.message}`);
      }
      if (err instanceof Anthropic.AnthropicError) {
        throw new BackendError("Claude: falta la API key. Usa «GhostCode: Guardar API key».", "auth");
      }
      throw err;
    }
  }
}

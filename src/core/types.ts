/** Fragmento de otro archivo abierto que se usa como contexto extra. */
export interface Snippet {
  path: string;
  text: string;
  score: number;
}

/** Todo lo que un backend necesita para generar una sugerencia. */
export interface CompletionRequest {
  /** Texto antes del cursor (ya recortado al presupuesto). */
  prefix: string;
  /** Texto después del cursor (ya recortado al presupuesto). */
  suffix: string;
  /** Ruta relativa del archivo, para dar contexto al modelo. */
  filePath: string;
  languageId: string;
  snippets: Snippet[];
  multiline: boolean;
  maxTokens: number;
  temperature: number;
  /** Estilo del usuario medido por Halo IA (p. ej. "2-space indentation, single quotes…"). */
  style?: string;
}

/** Petición de texto libre (herramientas como las anotaciones), no de autocompletado. */
export interface ChatRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

export interface Backend {
  /** Identificador estable (se usa en la clave de caché). */
  readonly id: string;
  /** Texto corto para la barra de estado. */
  readonly label: string;
  /** true si el modelo es de chat (no FIM) y puede repetir el texto ya escrito o usar ``` */
  readonly isChat: boolean;
  /** Emite trozos de texto a medida que llegan. Debe respetar `signal`. */
  complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string>;
  /** Respuesta de chat en streaming (system + user). */
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<string>;
}

/** Error con un mensaje pensado para mostrarse al usuario. */
export class BackendError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "connection" | "model" | "rate-limit" | "other" = "other",
  ) {
    super(message);
  }
}

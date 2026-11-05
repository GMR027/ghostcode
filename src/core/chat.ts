import type { ChatMessage, ChatRequest } from "./types";

/** Cuántos caracteres de conversación se envían al modelo (los mensajes nuevos no cuentan). */
export const MAX_HISTORY_CHARS = 16_000;
/** Cuántos turnos anteriores se envían como máximo. */
export const MAX_HISTORY_MESSAGES = 20;

export interface ChatContext {
  languageId: string;
  filePath: string;
}

/**
 * Conserva los turnos más recientes que caben en el presupuesto y quita un posible
 * primer turno del asistente: la conversación debe empezar hablando el usuario.
 */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (kept.length >= MAX_HISTORY_MESSAGES) break;
    if (chars + msg.content.length > MAX_HISTORY_CHARS) {
      // Un único mensaje enorme (código pegado) se recorta por el principio, que es
      // donde suele estar el contexto menos útil para la pregunta actual.
      if (!kept.length) kept.unshift({ ...msg, content: msg.content.slice(-MAX_HISTORY_CHARS) });
      break;
    }
    kept.unshift(msg);
    chars += msg.content.length;
  }
  while (kept[0]?.role === "assistant") kept.shift();
  return kept;
}

/** Petición del chat: prompt de sistema + historial + la pregunta nueva. */
export function chatRequest(
  history: ChatMessage[],
  question: string,
  context: ChatContext | undefined,
  lang: string,
): ChatRequest {
  const where = context
    ? `The file open in the editor is ${context.filePath} (${context.languageId}).`
    : "The user may not have a file open.";
  return {
    system: [
      "You are the GhostCode ghost, a senior developer helping the user inside VS Code.",
      "The user pastes code excerpts and asks questions about them: what the code does, how to use it, why it fails, where the error is, security problems, refactors, improvements…",
      "Answer in Markdown: short paragraphs and bullets. When you show code, use a fenced block with the language.",
      "If the user asks about an error, name the line or expression, explain why it fails and give the concrete fix.",
      "If the user asks for a refactor or improvement, preserve the behavior, explain the idea briefly and show before/after only when it helps.",
      "Do not invent files, APIs or behavior. If you need more code or context, ask for it.",
      "Never claim that you ran or tested the code.",
      where,
      `Write in ${lang}, the same language the user writes in.`,
    ].join("\n"),
    user: question,
    messages: [...trimHistory(history), { role: "user", content: question }],
    maxTokens: 2000,
    temperature: 0.2,
  };
}

import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { cleanAssistantReply } from "./core/assistant";
import { chatRequest } from "./core/chat";
import { buildQuery, sourcesFooter } from "./core/docs";
import type { ChatMessage } from "./core/types";
import { withConexiones } from "./conexiones";
import { chatBackend, runChat } from "./tools";

/**
 * Responde un turno del chat con el historial de la sesión. Devuelve undefined si
 * el usuario canceló o el modelo falló (en ese caso ya se mostró el error).
 */
export async function askChat(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  log: vscode.LogOutputChannel,
  history: ChatMessage[],
  question: string,
): Promise<string | undefined> {
  const text = (question ?? "").trim();
  if (!text) {
    void vscode.window.showInformationMessage("GhostCode: escribe un mensaje para el asistente.");
    return undefined;
  }

  const backend = await chatBackend(secrets, mode);
  if (!backend) return;

  const editor = vscode.window.activeTextEditor;
  const context = editor
    ? {
        languageId: editor.document.languageId,
        filePath: vscode.workspace.asRelativePath(editor.document.uri),
      }
    : undefined;
  const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";

  // Con Conexiones instalada, el chat también ve la documentación guardada que venga al caso.
  const docs = await withConexiones(
    chatRequest(history, text, context, lang),
    buildQuery(text.slice(0, 1200)),
    [editor?.document.languageId ?? "unknown"],
  );
  const raw = await runChat(backend, docs.req, "pensando", log);
  if (raw === undefined) return undefined;
  const reply = cleanAssistantReply(raw);
  return reply ? reply + sourcesFooter(docs.sources) : undefined;
}

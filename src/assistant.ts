import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import { assistantRequest, cleanAssistantReply, guessLanguage } from "./core/assistant";
import { chatBackend, runChat } from "./tools";

/** Explica el código pegado en el panel y lo revisa (errores y seguridad). Undefined si se canceló o falló. */
export async function askAssistant(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel, code: string): Promise<string | undefined> {
  const text = (code ?? "").trim();
  if (!text) {
    void vscode.window.showInformationMessage("GhostCode: pega o escribe el código que quieres que el asistente revise.");
    return undefined;
  }
  const backend = await chatBackend(secrets, mode);
  if (!backend) return undefined;
  const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";
  const editorLang = vscode.window.activeTextEditor?.document.languageId ?? "unknown";
  const raw = await runChat(backend, assistantRequest(text.slice(0, 15_000), guessLanguage(text, editorLang), lang), "revisando el código", log);
  if (raw === undefined) return undefined;
  const reply = cleanAssistantReply(raw);
  return reply || undefined;
}

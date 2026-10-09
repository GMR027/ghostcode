import * as vscode from "vscode";
import { ANTHROPIC_DEFAULT_MODEL, AnthropicBackend } from "./backends/anthropic";
import { CODESTRAL_DEFAULT_MODEL, CODESTRAL_DEFAULT_URL, CodestralBackend } from "./backends/codestral";
import { OllamaBackend } from "./backends/ollama";
import { OPENAI_DEFAULT_URL, OpenAICompatBackend } from "./backends/openaiCompat";
import { BackendError, type Backend } from "./core/types";

export type Mode = "local" | "api" | "off";
export type ApiProvider = "anthropic" | "codestral" | "openai-compatible";

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  anthropic: "Anthropic Claude",
  codestral: "Mistral Codestral",
  "openai-compatible": "Compatible con OpenAI",
};

const ENV_KEYS: Record<ApiProvider, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  codestral: ["CODESTRAL_API_KEY", "MISTRAL_API_KEY"],
  "openai-compatible": ["OPENAI_API_KEY"],
};

export function cfg() {
  const c = vscode.workspace.getConfiguration("ghostcode");
  return {
    mode: c.get<Mode>("mode", "local"),
    localUrl: c.get<string>("local.url", "http://localhost:11434"),
    localModel: c.get<string>("local.model", "qwen2.5-coder:1.5b-base"),
    localChatModel: c.get<string>("local.chatModel", ""),
    annotationLanguage: c.get<string>("annotationLanguage", "auto"),
    hoverExplain: c.get<boolean>("hoverExplain", true),
    fixPreview: c.get<boolean>("fixPreview", true),
    indentSize: c.get<number>("indentSize", 0),
    pathCheck: c.get<boolean>("pathCheck", true),
    haloEnabled: c.get<boolean>("halo.enabled", true),
    promptsFile: c.get<string>("promptsFile", "PROMPTS.md"),
    apiProvider: c.get<ApiProvider>("api.provider", "anthropic"),
    apiModel: c.get<string>("api.model", ""),
    apiBaseUrl: c.get<string>("api.baseUrl", ""),
    apiUseFim: c.get<boolean>("api.useFim", true),
    debounceMs: c.get<number>("debounceMs", 0),
    maxPrefixChars: c.get<number>("maxPrefixChars", 6000),
    maxSuffixChars: c.get<number>("maxSuffixChars", 2000),
    maxTokens: c.get<number>("maxTokens", 256),
    temperature: c.get<number>("temperature", 0.2),
    multiline: c.get<"auto" | "always" | "never">("multiline", "auto"),
    neighborTabs: c.get<boolean>("neighborTabs", true),
    projectContext: c.get<boolean>("projectContext", true),
    disabledLanguages: c.get<string[]>("disabledLanguages", []),
  };
}

export async function update(key: string, value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration("ghostcode").update(key, value, vscode.ConfigurationTarget.Global);
}

const secretName = (p: ApiProvider) => `ghostcode.apiKey.${p}`;

export async function getApiKey(secrets: vscode.SecretStorage, p: ApiProvider): Promise<string | undefined> {
  const stored = await secrets.get(secretName(p));
  if (stored) return stored;
  for (const env of ENV_KEYS[p]) if (process.env[env]) return process.env[env];
  return undefined;
}

export const setApiKey = (s: vscode.SecretStorage, p: ApiProvider, key: string) => s.store(secretName(p), key);
export const deleteApiKey = (s: vscode.SecretStorage, p: ApiProvider) => s.delete(secretName(p));

export function defaultApiModel(p: ApiProvider): string {
  if (p === "anthropic") return ANTHROPIC_DEFAULT_MODEL;
  if (p === "codestral") return CODESTRAL_DEFAULT_MODEL;
  return "";
}

/** Crea el backend según el modo elegido (o `mode`). Devuelve undefined si está desactivado. */
export async function createBackend(secrets: vscode.SecretStorage, mode = cfg().mode): Promise<Backend | undefined> {
  const c = cfg();
  if (mode === "off") return undefined;
  if (mode === "local") return new OllamaBackend(c.localUrl, c.localModel);

  const key = await getApiKey(secrets, c.apiProvider);
  const model = c.apiModel || defaultApiModel(c.apiProvider);
  switch (c.apiProvider) {
    case "anthropic":
      return new AnthropicBackend(key, model, c.apiBaseUrl || undefined);
    case "codestral":
      if (!key) throw new BackendError("Codestral: falta la API key. Usa «GhostCode: Guardar API key».", "auth");
      return new CodestralBackend(key, model, c.apiBaseUrl || CODESTRAL_DEFAULT_URL);
    case "openai-compatible":
      return new OpenAICompatBackend(key, model, c.apiBaseUrl || OPENAI_DEFAULT_URL, c.apiUseFim);
  }
}

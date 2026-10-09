import * as vscode from "vscode";
import { ANTHROPIC_MODELS } from "./backends/anthropic";
import { CODESTRAL_DEFAULT_URL } from "./backends/codestral";
import { OllamaBackend } from "./backends/ollama";
import {
  cfg, defaultApiModel, deleteApiKey, getApiKey, PROVIDER_LABELS, setApiKey, update,
  type ApiProvider,
} from "./config";

interface Pick<T> extends vscode.QuickPickItem {
  value: T;
}

/** Selector principal: Local / API / Desactivado. */
export async function selectMode(secrets: vscode.SecretStorage): Promise<void> {
  const c = cfg();
  const lang = vscode.window.activeTextEditor?.document.languageId;
  const langOff = lang ? c.disabledLanguages.includes(lang) : false;
  const items: Pick<string>[] = [
    {
      label: "$(device-desktop) Local (Ollama)",
      description: c.mode === "local" ? "● actual" : "",
      detail: `Gratis, privado y sin internet · modelo: ${c.localModel}`,
      value: "local",
    },
    {
      label: "$(cloud) API en la nube",
      description: c.mode === "api" ? "● actual" : "",
      detail: `${PROVIDER_LABELS[c.apiProvider]} · ${c.apiModel || defaultApiModel(c.apiProvider) || "sin modelo"}`,
      value: "api",
    },
    {
      label: "$(circle-slash) Desactivar",
      description: c.mode === "off" ? "● actual" : "",
      value: "off",
    },
    { label: "", kind: vscode.QuickPickItemKind.Separator, value: "" },
    { label: "$(server) Cambiar modelo local…", value: "local-model" },
    { label: "$(settings-gear) Configurar proveedor API…", value: "api-config" },
  ];
  if (lang) {
    items.push({ label: `$(code) ${langOff ? "Activar" : "Desactivar"} para «${lang}»`, value: "lang" });
  }
  items.push({ label: "$(output) Ver registro", value: "log" });

  const pick = await vscode.window.showQuickPick(items, { title: "GhostCode — modo de autocompletado" });
  if (!pick) return;
  switch (pick.value) {
    case "local":
      await update("mode", "local");
      break;
    case "api":
      await enableApiMode(secrets);
      break;
    case "off":
      await update("mode", "off");
      break;
    case "local-model":
      if (await selectLocalModel()) await update("mode", "local");
      break;
    case "api-config":
      if (await configureApi(secrets)) await update("mode", "api");
      break;
    case "lang":
      await toggleLanguage();
      break;
    case "log":
      await vscode.commands.executeCommand("ghostcode.showLog");
      break;
  }
}

/** Activa el modo API, lanzando el asistente si el proveedor aún no está configurado. */
export async function enableApiMode(secrets: vscode.SecretStorage): Promise<void> {
  const c = cfg();
  const hasKey = await getApiKey(secrets, c.apiProvider);
  const needsModel = c.apiProvider === "openai-compatible" && !c.apiModel;
  if ((!hasKey && c.apiProvider !== "openai-compatible") || needsModel) {
    if (!(await configureApi(secrets))) return;
  }
  await update("mode", "api");
}

/** Lista los modelos instalados en Ollama y permite elegir uno o descargar otro. */
export async function selectLocalModel(): Promise<boolean> {
  const c = cfg();
  let models: { name: string; size: number }[] = [];
  try {
    models = await OllamaBackend.listModels(c.localUrl);
  } catch {
    void vscode.window.showErrorMessage(
      `GhostCode: Ollama no responde en ${c.localUrl}. Instálalo/inícialo (scripts/install.sh) y vuelve a intentar.`,
    );
    return false;
  }
  const items: Pick<string>[] = models.map((m) => ({
    label: m.name,
    description: `${(m.size / 1e9).toFixed(1)} GB${m.name === c.localModel ? " · ● actual" : ""}`,
    detail: /base|code|starcoder|fim/i.test(m.name) ? "Apto para autocompletado (FIM)" : "Puede que no soporte FIM",
    value: m.name,
  }));
  items.push({
    label: "$(cloud-download) Descargar otro modelo…",
    detail: "qwen2.5-coder:1.5b-base · 3b-base · 7b-base · 14b-base, deepseek-coder-v2, codegemma:2b-code",
    value: "__pull__",
  });
  const pick = await vscode.window.showQuickPick(items, { title: "GhostCode — modelo local" });
  if (!pick) return false;
  let model = pick.value;
  if (model === "__pull__") {
    const name = await vscode.window.showInputBox({
      title: "Nombre del modelo de Ollama",
      value: "qwen2.5-coder:3b-base",
      prompt: "Recomendado: modelos *-base* de qwen2.5-coder (1.5b para equipos modestos, 7b con GPU de ≥8 GB)",
    });
    if (!name) return false;
    if (!(await pullModel(c.localUrl, name))) return false;
    model = name;
  }
  await update("local.model", model);
  return true;
}

/** Descarga un modelo de Ollama con progreso en una notificación (y en `onProgress`, 0–100). */
export async function pullModel(baseUrl: string, name: string, onProgress?: (pct: number) => void): Promise<boolean> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Descargando ${name}`, cancellable: true },
    async (progress, token) => {
      const abort = new AbortController();
      token.onCancellationRequested(() => abort.abort());
      try {
        const res = await fetch(baseUrl.replace(/\/+$/, "") + "/api/pull", {
          method: "POST",
          body: JSON.stringify({ model: name, stream: true }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const decoder = new TextDecoder();
        let buf = "";
        let last = 0;
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += decoder.decode(chunk, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines) {
            if (!l.trim()) continue;
            const m = JSON.parse(l) as { status?: string; total?: number; completed?: number; error?: string };
            if (m.error) throw new Error(m.error);
            const pct = m.total && m.completed ? Math.floor((m.completed / m.total) * 100) : undefined;
            progress.report({
              message: pct !== undefined ? `${m.status} ${pct}%` : m.status,
              increment: pct !== undefined ? Math.max(0, pct - last) : undefined,
            });
            if (pct !== undefined) {
              last = pct;
              onProgress?.(pct);
            }
          }
        }
        return true;
      } catch (err) {
        if (!token.isCancellationRequested) {
          void vscode.window.showErrorMessage(`GhostCode: no se pudo descargar ${name}: ${(err as Error).message}`);
        }
        return false;
      }
    },
  );
}

/** Asistente para elegir proveedor, URL, modelo y API key. */
export async function configureApi(secrets: vscode.SecretStorage): Promise<boolean> {
  const c = cfg();
  const providers: Pick<ApiProvider>[] = [
    { label: "Anthropic Claude", detail: "Claude Opus / Sonnet / Haiku", value: "anthropic" },
    { label: "Mistral Codestral", detail: "Especializado en código, FIM nativo, muy rápido", value: "codestral" },
    {
      label: "Compatible con OpenAI",
      detail: "OpenAI, DeepSeek, OpenRouter, Groq, Together, LM Studio, vLLM, llama.cpp…",
      value: "openai-compatible",
    },
  ];
  for (const p of providers) if (p.value === c.apiProvider) p.description = "● actual";
  const prov = await vscode.window.showQuickPick(providers, { title: "GhostCode — proveedor API (1/3)" });
  if (!prov) return false;
  const provider = prov.value;

  // URL base
  let baseUrl = provider === c.apiProvider ? c.apiBaseUrl : "";
  if (provider === "openai-compatible") {
    const url = await vscode.window.showInputBox({
      title: "GhostCode — URL base (2/3)",
      value: baseUrl || "https://api.openai.com/v1",
      prompt: "Ej.: https://api.deepseek.com/beta · https://openrouter.ai/api/v1 · http://localhost:1234/v1",
      ignoreFocusOut: true,
    });
    if (url === undefined) return false;
    baseUrl = url.trim();
  } else if (provider === "codestral") {
    const pick = await vscode.window.showQuickPick(
      [
        { label: CODESTRAL_DEFAULT_URL, detail: "Clave específica de Codestral (console.mistral.ai → Codestral)", value: "" },
        { label: "https://api.mistral.ai/v1", detail: "Clave general de la API de Mistral", value: "https://api.mistral.ai/v1" },
      ],
      { title: "GhostCode — endpoint de Codestral (2/3)" },
    );
    if (!pick) return false;
    baseUrl = pick.value;
  }

  // Modelo
  let model: string | undefined;
  const current = provider === c.apiProvider ? c.apiModel : "";
  if (provider === "anthropic") {
    const items: Pick<string>[] = ANTHROPIC_MODELS.map((m) => ({ label: m.id, detail: m.detail, value: m.id }));
    items.push({ label: "$(edit) Otro modelo…", value: "__other__" });
    const pick = await vscode.window.showQuickPick(items, { title: "GhostCode — modelo de Claude (3/3)" });
    if (!pick) return false;
    model = pick.value === "__other__" ? await vscode.window.showInputBox({ title: "ID del modelo", value: current }) : pick.value;
  } else {
    model = await vscode.window.showInputBox({
      title: "GhostCode — modelo (3/3)",
      value: current || defaultApiModel(provider),
      prompt:
        provider === "codestral"
          ? "Normalmente codestral-latest"
          : "Ej.: deepseek-chat, gpt-4.1-mini, qwen/qwen-2.5-coder-32b-instruct…",
      ignoreFocusOut: true,
    });
  }
  if (!model) return false;

  await update("api.provider", provider);
  await update("api.baseUrl", baseUrl);
  await update("api.model", model);

  if (!(await secrets.get(`ghostcode.apiKey.${provider}`))) {
    const optional = provider === "openai-compatible";
    const key = await askApiKey(provider, optional);
    if (key === undefined && !optional && !(await getApiKey(secrets, provider))) return false;
    if (key) await setApiKey(secrets, provider, key);
  }
  return true;
}

async function askApiKey(provider: ApiProvider, optional: boolean): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    title: `API key de ${PROVIDER_LABELS[provider]}`,
    prompt: `Se guarda cifrada en el llavero del sistema, nunca en settings.json.${optional ? " Déjala vacía si tu servidor local no la necesita." : ""}`,
    password: true,
    ignoreFocusOut: true,
  });
  return key?.trim() || undefined;
}

export async function setApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  const key = await askApiKey(cfg().apiProvider, false);
  if (!key) return;
  await setApiKey(secrets, cfg().apiProvider, key);
  void vscode.window.showInformationMessage(`GhostCode: API key de ${PROVIDER_LABELS[cfg().apiProvider]} guardada.`);
}

export async function clearApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  await deleteApiKey(secrets, cfg().apiProvider);
  void vscode.window.showInformationMessage(`GhostCode: API key de ${PROVIDER_LABELS[cfg().apiProvider]} borrada.`);
}

export async function toggleLanguage(): Promise<void> {
  const lang = vscode.window.activeTextEditor?.document.languageId;
  if (!lang) return;
  const list = cfg().disabledLanguages;
  const next = list.includes(lang) ? list.filter((l) => l !== lang) : [...list, lang];
  await update("disabledLanguages", next);
  void vscode.window.showInformationMessage(
    `GhostCode ${next.includes(lang) ? "desactivado" : "activado"} para «${lang}».`,
  );
}

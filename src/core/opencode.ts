import { BackendError } from "./types";

interface RunEvent {
  type?: string;
  part?: { type?: string; text?: string };
  error?: { type?: string; status?: number; message?: string; data?: { message?: string } };
}

/** Modelos de `opencode models`, uno por línea con el formato proveedor/modelo. */
export function parseModelList(out: string): string[] {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[\w.-]+\/\S+$/.test(l));
}

export type ModelKind = "free" | "subscription" | "other";

/** Gratis si el nombre lo dice; suscripción si es de OpenCode Go; el resto va con la cuenta del usuario. */
export function modelKind(id: string): ModelKind {
  if (/free/i.test(id)) return "free";
  if (id.startsWith("opencode-go/")) return "subscription";
  return "other";
}

export function opencodeError(err: RunEvent["error"]): BackendError {
  const raw = err?.data?.message ?? err?.message ?? "error desconocido";
  if (err?.type === "provider.free-limit" || err?.status === 429 || /usage limit|límite/i.test(raw)) {
    return new BackendError("OpenCode: has alcanzado el límite de uso gratuito. Suscríbete a OpenCode Go o elige otro modelo.", "rate-limit");
  }
  if (/auth|credential|log ?in|api key|unauthori/i.test(raw)) {
    return new BackendError("OpenCode: no hay una sesión iniciada. Ejecuta «opencode auth login».", "auth");
  }
  return new BackendError(`OpenCode: ${raw}`);
}

/** Une los trozos de texto de la salida JSON de `opencode run --format json` y traduce sus errores. */
export function parseRunOutput(out: string): string {
  let text = "";
  for (const line of out.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let ev: RunEvent;
    try {
      ev = JSON.parse(line) as RunEvent;
    } catch {
      continue;
    }
    if (ev.type === "error") throw opencodeError(ev.error);
    if (ev.part?.type === "text" && ev.part.text) text += ev.part.text;
  }
  return text.trim();
}

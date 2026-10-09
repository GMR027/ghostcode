import { BackendError } from "../core/types";

/** fetch con errores traducidos a mensajes entendibles. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
  serviceName: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new BackendError(`No se pudo conectar con ${serviceName} (${url}).`, "connection");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    const kind =
      res.status === 401 || res.status === 403 ? "auth"
      : res.status === 429 ? "rate-limit"
      : res.status === 404 ? "model"
      : "other";
    const msg =
      kind === "auth" ? `${serviceName}: API key inválida o sin permisos.`
      : kind === "rate-limit" ? `${serviceName}: límite de uso alcanzado (429).`
      : `${serviceName}: error ${res.status}. ${detail}`;
    const e = new BackendError(msg, kind);
    (e as BackendError & { status: number }).status = res.status;
    throw e;
  }
  return res;
}

/** Lee un body en streaming línea a línea. */
export async function* readLines(res: Response): AsyncIterable<string> {
  if (!res.body) return;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      yield line;
    }
  }
  buf += decoder.decode();
  if (buf) yield buf;
}

/** Itera los `data:` de un stream Server-Sent Events, parseados como JSON. */
export async function* readSse(res: Response): AsyncIterable<any> {
  for await (const line of readLines(res)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      yield JSON.parse(data);
    } catch {
      // línea incompleta o keep-alive: ignorar
    }
  }
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + path;
}

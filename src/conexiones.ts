import * as vscode from "vscode";
import type { ChatRequest } from "./core/types";
import { mergeDocs, type DocsContext } from "./core/docs";

const CONEXIONES_ID = "edgar.conexiones";

interface ConexionesApi {
  version: number;
  enabled(): boolean;
  context(query: string, opts?: { maxChars?: number; limit?: number; tags?: string[]; from?: string }): Promise<DocsContext | undefined>;
}

/**
 * Si el usuario tiene instalada la extensión Conexiones, añade al prompt la documentación que ya guardó y que viene al caso.
 * Nunca falla ni retrasa más de 2 s: sin Conexiones, sin documentación relevante o con el ajuste apagado, devuelve el prompt tal cual.
 */
export async function withConexiones(req: ChatRequest, query: string, tags: string[] = []): Promise<{ req: ChatRequest; sources: DocsContext["sources"] }> {
  const none = { req, sources: [] as DocsContext["sources"] };
  try {
    if (!query.trim() || !vscode.workspace.getConfiguration("ghostcode").get<boolean>("useConexiones", true)) return none;
    const ext = vscode.extensions.getExtension<ConexionesApi>(CONEXIONES_ID);
    if (!ext) return none;
    const api = ext.isActive ? ext.exports : await Promise.race([ext.activate(), new Promise<undefined>((r) => setTimeout(r, 2000))]);
    if (!api || api.version !== 1 || !api.enabled()) return none;
    const ctx = await Promise.race([api.context(query, { from: "ghostcode", tags, maxChars: 2500, limit: 3 }), new Promise<undefined>((r) => setTimeout(r, 2000))]);
    return ctx ? { req: mergeDocs(req, ctx), sources: ctx.sources } : none;
  } catch {
    return none;
  }
}

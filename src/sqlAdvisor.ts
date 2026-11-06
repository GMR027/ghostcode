import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { literalAt } from "./core/literals";
import { resolveAnnotationLanguage, LANGUAGE_NAMES } from "./core/annotate";
import type { ChatRequest } from "./core/types";
import { chatBackend, runChat } from "./tools";

/** Petición para revisar una consulta SQL e indicar qué índices le faltan. */
export function indexAdvisorRequest(sql: string, languageId: string, uiLanguage: string): ChatRequest {
  const lang = LANGUAGE_NAMES[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  return {
    system: [
      "You are a database performance reviewer. Analyse the SQL query and the surrounding code.",
      "Answer in this exact structure with short markdown sections:",
      "## Índices recomendados — one line per index: `CREATE INDEX ... ON table (columns)` and the query part it helps.",
      "## Consulta reescrita — the same query optimised, without changing its result.",
      "## Por qué — 3 to 6 bullets about scans, joins, filters, sorting and cardinality.",
      "## Riesgos — writes slowed, storage, existing redundant indexes; say when no index is needed.",
      "Never invent table or column names that are not in the query. If information is missing, say what you would need.",
      `Write in ${lang}.`,
    ].join("\n"),
    user: `Language: ${languageId}\n<sql>\n${sql.slice(0, 12_000)}\n</sql>`,
    maxTokens: 1100,
    temperature: 0.15,
  };
}

/** Toma la consulta seleccionada (o la que hay bajo el cursor) y pide índices. */
export async function adviseSqlIndexes(
  secrets: vscode.SecretStorage,
  mode: Exclude<Mode, "off">,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("GhostCode: abre un archivo con una consulta SQL y selecciónala.");
    return;
  }
  const doc = editor.document;
  let sql = editor.selection.isEmpty ? "" : doc.getText(editor.selection).trim();
  if (!sql) {
    const literal = literalAt(doc.getText().split(/\r?\n/), editor.selection.active.line, editor.selection.active.character, doc.languageId);
    if (literal?.kind === "sql") sql = literal.text;
  }
  if (!sql) {
    void vscode.window.showInformationMessage("GhostCode: selecciona una consulta SQL (o coloca el cursor dentro de ella).");
    return;
  }
  let backend;
  try {
    backend = await chatBackend(secrets, mode);
  } catch (err) {
    void vscode.window.showErrorMessage(`GhostCode: ${(err as Error).message}`);
    return;
  }
  if (!backend) return;
  const ui = resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env);
  const reply = await runChat(backend, indexAdvisorRequest(sql, doc.languageId, ui), "revisando índices SQL", log);
  if (!reply) return;
  const content = `# Asesor de índices SQL\n\n\`\`\`sql\n${sql.slice(0, 4000)}\n\`\`\`\n\n${reply}`;
  const out = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(out, { preview: true });
}

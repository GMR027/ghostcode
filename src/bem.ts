import * as vscode from "vscode";
import { cfg, type Mode } from "./config";
import { LANGUAGE_NAMES, resolveAnnotationLanguage } from "./core/annotate";
import {
  bemRequest, blockFor, blockOf, knownModifiers, openAncestors, parseBemNames, parseMarkup, planBem, resolveBemEdits, slug,
  suggestBlockName, suggestElementName, type MarkupNode,
} from "./core/bem";
import { chatBackend, runChat } from "./tools";

export const BEM_LANGUAGES = ["html", "php", "vue", "svelte", "astro", "javascriptreact", "typescriptreact", "blade", "twig", "handlebars"];
const COMMON_MODIFIERS = ["active", "disabled", "primary", "secondary", "large", "small", "hidden", "selected"];
const GENERIC_TAGS = new Set(["div", "section", "article", "aside", "main", "span"]);

/** Dentro de class="…" sugiere nombres BEM según las etiquetas hijas y su contenido. */
export class BemCompletions implements vscode.CompletionItemProvider {
  static readonly triggers = ['"', "'", " ", "_", "-"];

  provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
    if (!cfg().bem) return;
    const text = doc.getText();
    const offset = doc.offsetAt(pos);
    const before = text.slice(0, offset);
    const lt = before.lastIndexOf("<");
    if (lt < 0) return;
    const head = /^<([A-Za-z][\w:.-]*)\b[\s\S]*?\b(?:class|className)\s*=\s*(["'])([^"']*)$/.exec(before.slice(lt));
    if (!head) return;
    const typed = head[3];
    const token = /\S*$/.exec(typed)![0];
    const range = new vscode.Range(pos.translate(0, -token.length), pos);

    // La etiqueta actual con sus hijas: se quita lo que falta por escribir del valor para poder leerla.
    const rest = text.slice(offset);
    const closeQuote = rest.indexOf(head[2]);
    const fragment = closeQuote < 0 ? "" : before.slice(lt) + rest.slice(closeQuote);
    const own = parseMarkup(fragment);
    const nodes: MarkupNode[] = own.length ? own : parseMarkup(`<${head[1]}>`);
    const block = blockFor(openAncestors(before.slice(0, lt)));
    const file = doc.uri.path.split("/").pop()?.replace(/\..*$/, "") ?? "";

    const items: vscode.CompletionItem[] = [];
    const add = (label: string, detail: string, rank: string) => {
      if (items.some((i) => i.label === label)) return;
      const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Class);
      item.detail = `BEM · ${detail}`;
      item.range = range;
      item.sortText = `0${rank}${label}`;
      item.filterText = label;
      items.push(item);
    };

    if (!block) {
      const name = suggestBlockName(nodes, 0, file);
      add(name, "bloque", "0");
      if (slug(file)) add(slug(file), "bloque (nombre del archivo)", "1");
      return items;
    }
    const element = suggestElementName(nodes, 0, block);
    add(element, "elemento", "0");
    // Nombres de este bloque que el usuario ya usa en el archivo: se mantienen consistentes.
    const used = new Set([...text.matchAll(new RegExp(`(?<![\\w-])${block}__[a-z0-9-]+(?![\\w-])`, "g"))].map((m) => m[0]));
    for (const u of used) add(u, "ya usado en este archivo", "1");
    // Modificadores del nombre que se está escribiendo (o del sugerido).
    const base = token.includes("--") ? token.split("--")[0] : token.startsWith(`${block}__`) ? token : element;
    for (const mod of new Set([...knownModifiers(text, base), ...COMMON_MODIFIERS])) add(`${base}--${mod}`, "modificador", "2");
    if (!token.startsWith(`${block}__`) && !token.startsWith(`${block}--`)) add(block, "bloque (este mismo)", "3");
    return items;
  }
}

/**
 * «Aplicar BEM»: da clases BEM al elemento del cursor (o a la selección) y a lo que contiene.
 * Solo rellena las etiquetas SIN clase; lo que el usuario ya escribió o cambió no se toca.
 */
export async function applyBem(secrets: vscode.SecretStorage, mode: Exclude<Mode, "off">, log: vscode.LogOutputChannel): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const doc = editor.document;
  const text = doc.getText();
  const nodes = parseMarkup(text);
  const attr = /react$/.test(doc.languageId) || /\bclassName\s*=/.test(text) ? "className" : "class";

  // Raíces: lo seleccionado o el elemento donde está el cursor.
  const sel = editor.selection;
  let roots: number[];
  if (!sel.isEmpty) {
    const [a, b] = [doc.offsetAt(sel.start), doc.offsetAt(sel.end)];
    const inside = nodes.map((n, i) => i).filter((i) => nodes[i].start >= a && nodes[i].end <= b);
    roots = inside.filter((i) => !inside.includes(nodes[i].parent));
  } else {
    const off = doc.offsetAt(sel.active);
    const at = nodes.map((n, i) => i).filter((i) => nodes[i].start <= off && off < nodes[i].end);
    roots = at.length ? [at.reduce((a, b) => (nodes[b].depth > nodes[a].depth ? b : a))] : [];
  }
  if (!roots.length) {
    void vscode.window.showInformationMessage("GhostCode: coloca el cursor dentro de una etiqueta (o selecciona el bloque) para aplicar BEM.");
    return;
  }

  // La IA nombra las etiquetas genéricas (div, span…) por lo que contienen; sin IA se usan nombres por defecto.
  const subtree = (i: number): number[] => [i, ...nodes[i].children.flatMap(subtree)];
  const wanted = roots.flatMap(subtree).filter((i) => GENERIC_TAGS.has(nodes[i].tag) && !nodes[i].cls?.value.trim()).slice(0, 40);
  let names = new Map<number, string>();
  if (wanted.length) {
    const backend = await chatBackend(secrets, mode, false);
    if (backend) {
      const first = planBem(nodes, roots[0], attr).block;
      const lang = LANGUAGE_NAMES[resolveAnnotationLanguage(cfg().annotationLanguage, vscode.env.language, process.env).slice(0, 2)] ?? "English";
      const raw = await runChat(
        backend,
        bemRequest(wanted.map((i) => ({ i, tag: nodes[i].tag, text: nodes[i].text, parent: nodes[i].parent })), first, lang),
        "nombrando elementos BEM",
        log,
      );
      if (raw) names = parseBemNames(raw, wanted);
    }
  }

  const edit = new vscode.WorkspaceEdit();
  let count = 0;
  const blocks = new Set<string>();
  for (const root of roots) {
    const { edits, block } = planBem(nodes, root, attr, { names, fallbackBlock: doc.uri.path.split("/").pop()?.replace(/\..*$/, "") });
    blocks.add(block);
    for (const e of resolveBemEdits(text, edits)) {
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(e.at), doc.positionAt(e.end)), e.text);
      count++;
    }
  }
  if (!count) {
    void vscode.window.showInformationMessage("GhostCode: todas las etiquetas de ese bloque ya tienen clase; no se cambió nada.");
    return;
  }
  await vscode.workspace.applyEdit(edit);
  void vscode.window.setStatusBarMessage(`$(check) GhostCode BEM: ${count} clase(s) añadidas (${[...blocks].map((b) => blockOf(b)).join(", ")})`, 6000);
}

import * as vscode from "vscode";
import { extractDeclarations, type Declaration } from "./core/declarations";
import type { ProjectIndex } from "./projectIndex";

/**
 * Localizar funciones, métodos y clases en un documento. Usa el proveedor de símbolos
 * del lenguaje si existe (más preciso) y, si no, las reglas de texto de
 * core/declarations, que funcionan con cualquier lenguaje.
 */

export const KINDS = new Map<vscode.SymbolKind, string>([
  [vscode.SymbolKind.Function, "function"],
  [vscode.SymbolKind.Method, "method"],
  [vscode.SymbolKind.Constructor, "constructor"],
  [vscode.SymbolKind.Class, "class"],
  [vscode.SymbolKind.Interface, "interface"],
  [vscode.SymbolKind.Enum, "enum"],
  [vscode.SymbolKind.Struct, "struct"],
]);

export async function documentSymbols(doc: vscode.TextDocument): Promise<vscode.DocumentSymbol[]> {
  let res: (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined;
  try {
    res = await vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", doc.uri);
  } catch {
    res = undefined;
  }
  if (!res?.length) return fromDeclarations(doc);
  // Algunos proveedores devuelven SymbolInformation (sin selectionRange) o, como Intelephense,
  // un selectionRange que ocupa todo el cuerpo: entonces se busca el nombre en la declaración.
  const fix = (s: vscode.DocumentSymbol | vscode.SymbolInformation): vscode.DocumentSymbol => {
    const sym: vscode.DocumentSymbol =
      "selectionRange" in s ? s : ({ ...s, range: s.location.range, selectionRange: s.location.range, children: [], detail: "" } as vscode.DocumentSymbol);
    const selection = sym.selectionRange.isSingleLine && !sym.selectionRange.isEqual(sym.range) ? sym.selectionRange : nameRange(doc, sym.name, sym.range.start);
    return { ...sym, selectionRange: selection, children: (sym.children ?? []).map(fix) } as vscode.DocumentSymbol;
  };
  return res.map(fix);
}

/** Símbolos a partir de las reglas de texto (lenguajes sin proveedor de símbolos). */
function fromDeclarations(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
  return extractDeclarations(doc.getText())
    .filter((d) => d.kind !== "field")
    .map((d) => declToSymbol(doc, d));
}

export function declToSymbol(doc: vscode.TextDocument, d: Declaration): vscode.DocumentSymbol {
  const end = Math.min(d.end ?? d.line, doc.lineCount - 1);
  const range = new vscode.Range(d.line, 0, end, doc.lineAt(end).text.length);
  const kind = d.kind === "class" ? vscode.SymbolKind.Class : d.container ? vscode.SymbolKind.Method : vscode.SymbolKind.Function;
  return new vscode.DocumentSymbol(d.name, "", kind, range, nameRange(doc, d.name, range.start));
}

/** Dónde aparece el nombre del símbolo al principio de su declaración. */
export function nameRange(doc: vscode.TextDocument, symbolName: string, from: vscode.Position): vscode.Range {
  const name = symbolName.replace(/\(.*$/, "").trim();
  const start = doc.offsetAt(from);
  const head = doc.getText(new vscode.Range(from, doc.positionAt(start + 400)));
  const at = name ? new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}(?![\\w$])`).exec(head)?.index : undefined;
  if (at === undefined) return new vscode.Range(from, from);
  return new vscode.Range(doc.positionAt(start + at), doc.positionAt(start + at + name.length));
}

export const flattenSymbols = (symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] =>
  symbols.flatMap((s) => [s, ...flattenSymbols(s.children ?? [])]);
const flatten = flattenSymbols;

/**
 * El símbolo explicable cuyo nombre está en `pos` (o que empieza justo ahí, según el
 * proveedor). Una variable dentro de una función no cuenta como la función.
 */
export function symbolAt(symbols: vscode.DocumentSymbol[], pos: vscode.Position): vscode.DocumentSymbol | undefined {
  return flatten(symbols)
    .filter((s) => KINDS.has(s.kind) && s.range.contains(pos) && (s.selectionRange.contains(pos) || s.range.start.isEqual(pos)))
    .sort((a, b) => b.range.start.compareTo(a.range.start))[0];
}

/** La función/método/clase más interna que contiene `pos` (para documentar o arreglar). */
export function enclosingSymbol(
  symbols: vscode.DocumentSymbol[],
  pos: vscode.Position,
  prefer: "function" | "any" = "any",
): vscode.DocumentSymbol | undefined {
  const containing = flatten(symbols)
    .filter((s) => KINDS.has(s.kind) && s.range.contains(pos))
    .sort((a, b) => b.range.start.compareTo(a.range.start));
  if (prefer === "function") {
    return containing.find((s) => !/class|interface|enum|struct/.test(KINDS.get(s.kind)!)) ?? containing[0];
  }
  return containing[0];
}

// Definiciones de librerías: no vale la pena explicarlas (y suelen ser solo firmas).
const LIBRARY_RE = /[\\/](node_modules|vendor|site-packages|\.venv)[\\/]|\.d\.ts$/;

export interface Target {
  doc: vscode.TextDocument;
  symbol: vscode.DocumentSymbol;
}

/** El símbolo bajo el puntero: su declaración, la definición de lo que se usa, o el índice del proyecto. */
export async function findDefinition(
  doc: vscode.TextDocument,
  pos: vscode.Position,
  word: string,
  project?: ProjectIndex,
): Promise<Target | undefined> {
  const own = symbolAt(await documentSymbols(doc), pos);
  if (own) return { doc, symbol: own };

  let defs: (vscode.Location | vscode.LocationLink)[] | undefined;
  try {
    defs = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", doc.uri, pos);
  } catch {
    defs = undefined;
  }
  // Puede haber varias (p. ej. la misma función en dos archivos): primero la del propio archivo.
  const candidates = (defs ?? [])
    .map((d) => ("targetUri" in d ? { uri: d.targetUri, at: (d.targetSelectionRange ?? d.targetRange).start } : { uri: d.uri, at: d.range.start }))
    .sort((x, y) => Number(y.uri.toString() === doc.uri.toString()) - Number(x.uri.toString() === doc.uri.toString()));
  for (const { uri, at } of candidates) {
    const same = uri.toString() === doc.uri.toString();
    if (LIBRARY_RE.test(uri.fsPath) || (!same && !vscode.workspace.getWorkspaceFolder(uri))) continue;
    const defDoc = same ? doc : await vscode.workspace.openTextDocument(uri);
    const symbol = symbolAt(await documentSymbols(defDoc), at);
    if (symbol) return { doc: defDoc, symbol };
  }
  if (candidates.length) return undefined;

  // Sin proveedor de definiciones (lenguajes sin extensión): buscar el nombre en el archivo y en el proyecto.
  const local = flattenSymbols(await documentSymbols(doc)).find((s) => s.name === word && KINDS.has(s.kind));
  if (local) return { doc, symbol: local };
  const entry = project?.lookup(word).find((e) => e.decl.kind !== "field");
  const uri = entry && project?.uriOf(entry.path);
  if (!entry || !uri) return undefined;
  const defDoc = await vscode.workspace.openTextDocument(uri);
  return { doc: defDoc, symbol: declToSymbol(defDoc, entry.decl) };
}

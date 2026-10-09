import { extractDeclarations, membersOf, outlineOf, type Declaration } from "./declarations";
import type { Snippet } from "./types";

// Extensiones que comparten "idioma" a efectos de contexto (JS puede usar clases de TS, etc.).
const FAMILIES: Record<string, string> = {
  js: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", mts: "js", cts: "js", vue: "js", svelte: "js",
  c: "c", h: "c", cc: "c", cpp: "c", cxx: "c", hpp: "c", hh: "c", m: "c", mm: "c",
  kt: "jvm", kts: "jvm", java: "jvm", scala: "jvm", groovy: "jvm",
  ex: "ex", exs: "ex", pl: "pl", pm: "pl", sh: "sh", bash: "sh",
};
export const familyOf = (ext: string) => FAMILIES[ext] ?? ext;
const family = (path: string) => familyOf(path.slice(path.lastIndexOf(".") + 1).toLowerCase());

interface Entry {
  path: string;
  decl: Declaration;
}

/**
 * Índice de declaraciones del proyecto: nombre → dónde está declarado. Con él, al
 * autocompletar se añade al prompt la API real de las clases y funciones que se
 * están usando (para que el modelo no invente métodos).
 */
export class DeclarationIndex {
  private readonly files = new Map<string, Declaration[]>();
  private readonly byName = new Map<string, Entry[]>();

  get fileCount(): number {
    return this.files.size;
  }

  set(path: string, text: string): void {
    this.delete(path);
    const decls = extractDeclarations(text);
    this.files.set(path, decls);
    for (const decl of decls) {
      if (decl.kind === "field") continue;
      const list = this.byName.get(decl.name) ?? [];
      list.push({ path, decl });
      this.byName.set(decl.name, list);
    }
  }

  delete(path: string): void {
    const old = this.files.get(path);
    if (!old) return;
    this.files.delete(path);
    for (const decl of old) {
      const list = this.byName.get(decl.name)?.filter((e) => e.path !== path);
      if (list?.length) this.byName.set(decl.name, list);
      else this.byName.delete(decl.name);
    }
  }

  /**
   * Resumen del proyecto: clases (con sus miembros) y funciones sueltas por archivo,
   * empezando por controladores, modelos y rutas.
   */
  outlines(maxChars = 6000): string[] {
    const rank = (p: string) => (/controller|model|route|service|api|class/i.test(p) ? 0 : /view|template|component/i.test(p) ? 2 : 1);
    const out: string[] = [];
    let used = 0;
    for (const [path, decls] of [...this.files.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))) {
      const top = decls.filter((d) => d.kind === "class" || (d.kind === "function" && !d.container));
      if (!top.length) continue;
      const text = `// ${path}\n` + top.map((d) => (d.kind === "class" ? outlineOf(decls, d, 15) : d.signature)).join("\n");
      if (used + text.length > maxChars) break;
      out.push(text);
      used += text.length;
    }
    return out;
  }

  lookup(name: string): Entry[] {
    return this.byName.get(name) ?? [];
  }

  /** La primera declaración de clase `name` en `path`. */
  private classIn(path: string, name: string): Declaration | undefined {
    return this.files.get(path)?.find((d) => d.kind === "class" && d.name === name);
  }

  /**
   * Fragmentos para el prompt a partir de los nombres usados cerca del cursor
   * (del más cercano al más lejano). Excluye el archivo actual, que ya va en el prompt.
   */
  snippetsFor(names: string[], currentPath: string, budget = 1800, maxSnippets = 4): Snippet[] {
    const fam = family(currentPath);
    const out: Snippet[] = [];
    const seen = new Set<string>();
    let used = 0;

    const add = (path: string, decl: Declaration): boolean => {
      const key = `${path}:${decl.line}`;
      if (seen.has(key)) return true;
      let text = decl.signature;
      if (decl.kind === "class") {
        // Un nivel de herencia, dentro del mismo resumen: los métodos heredados son API de la clase.
        const parent = decl.parent ? this.lookup(decl.parent).find((p) => p.decl.kind === "class" && family(p.path) === fam) : undefined;
        const inherited = parent ? { from: parent.decl.name, members: membersOf(this.files.get(parent.path)!, parent.decl) } : undefined;
        text = outlineOf(this.files.get(path)!, decl, 25, inherited);
      }
      if (out.length >= maxSnippets) return false;
      if (used + text.length > budget) return true; // no cabe: probar con los siguientes
      seen.add(key);
      used += text.length;
      out.push({ path, text, score: 1 });
      return true;
    };

    for (const name of names) {
      const entries = this.lookup(name).filter((e) => e.path !== currentPath && family(e.path) === fam);
      // Nombres muy repetidos (p. ej. un método "guardar" en 10 clases) no aportan.
      if (!entries.length || (entries.length > 4 && !entries.some((e) => e.decl.kind === "class"))) continue;
      for (const e of entries.slice(0, 2)) {
        const target = e.decl.kind === "class" ? e.decl : e.decl.container ? (this.classIn(e.path, e.decl.container) ?? e.decl) : e.decl;
        if (!add(e.path, target)) return out;
      }
    }
    return out;
  }
}

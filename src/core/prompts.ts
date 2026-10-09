import { posix } from "node:path";
import type { Stack } from "./extensions";
import type { ChatRequest } from "./types";

// --- Prompt reutilizable a partir de código ------------------------------------------------

export function codePromptRequest(code: string, languageId: string, filePath: string, lang: string): ChatRequest {
  return {
    system: [
      "Write a reusable prompt that a developer can paste into an AI coding assistant in ANOTHER project",
      "to get code equivalent to the one below. The prompt must be self-contained: do not mention this project's file names.",
      "Structure it in Markdown with these sections: **Objetivo**, **Entradas y salidas**, **Comportamiento** (bullets, including edge cases and validations),",
      "**Requisitos técnicos** (language, libraries, conventions seen in the code) and **Restricciones**.",
      "Be specific and concise. Do not include the code itself. Reply with ONLY the prompt.",
      `Write it in ${lang} (keep the section titles in that language).`,
    ].join("\n"),
    user: `Language: ${languageId}\n<code>\n${code}\n</code>`,
    maxTokens: 700,
    temperature: 0.3,
  };
}

/** El prompt final: lo que escribió el modelo + el código como referencia. */
export function finishCodePrompt(modelText: string, code: string, languageId: string): string {
  const body = modelText.replace(/^```(?:markdown|md)?\n|```\s*$/g, "").trim();
  return `${body}\n\n**Código de referencia** (${languageId}):\n\n\`\`\`${languageId}\n${code.replace(/\s+$/, "")}\n\`\`\`\n`;
}

/** Entrada para PROMPTS.md. */
export function promptEntry(prompt: string, source: string, date: Date): string {
  const title = /\*\*Objetivo\*\*:?\s*\n*([^\n]+)/.exec(prompt)?.[1]?.replace(/[*_`#]/g, "").trim().slice(0, 80) || "Prompt";
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `## ${title}\n\n> ${stamp} · origen: \`${source}\`\n\n${prompt.trim()}\n\n---\n\n`;
}

export const PROMPTS_HEADER = "# Prompts del proyecto\n\nPrompts reutilizables generados con GhostCode a partir del código de este proyecto.\n\n---\n\n";

// --- Contexto del proyecto ------------------------------------------------------------------

const FRONTEND_DIR = /^(public|static|assets|www|web|views|templates|components|pages|layouts|styles|css|scss|sass|js|resources\/(views|js|css|sass)|src\/(js|css|scss|sass|styles|components|pages|views|assets|app|ui))(\/|$)/i;
const BACKEND_DIR = /^(controllers?|models?|routes?|router|api|classes|includes|services?|middlewares?|database|migrations|server|lib|app\/(Http|Models|Services)|src\/(controllers?|models?|routes?|api|server|services?))(\/|$)/i;
const SKIP_DIR = /(^|\/)(node_modules|vendor|\.git|dist|build|out|coverage|\.next|\.nuxt|__pycache__|\.venv|venv)(\/|$)/;

export interface ProjectFacts {
  name: string;
  description?: string;
  readme?: string;
  stack: Stack;
  dependencies: { runtime: string[]; dev: string[] };
  scripts: Record<string, string>;
  tree: string;
  frontend: string[];
  backend: string[];
  routes: string[];
  entryPoints: string[];
}

export function gatherFacts(
  folderName: string,
  files: string[],
  manifests: Record<string, string>,
  stack: Stack,
  routes: string[],
  readme?: string,
): ProjectFacts {
  const visible = files.filter((f) => !SKIP_DIR.test(f)).sort();
  const runtime: string[] = [];
  const dev: string[] = [];
  const scripts: Record<string, string> = {};
  let name = folderName;
  let named = false;
  let description: string | undefined;
  for (const [file, text] of Object.entries(manifests)) {
    if (!/\.json$/.test(file)) {
      runtime.push(...(text.match(/^[A-Za-z][\w.-]*/gm) ?? []));
      continue;
    }
    try {
      const j = JSON.parse(text);
      // El nombre del package.json manda; el de composer.json ("dueño/nombre") solo si no hay otro.
      if (j.name && file === "package.json") [name, named] = [j.name, true];
      if (j.name && file === "composer.json" && !named) name = String(j.name).split("/").pop()!;
      description ??= j.description;
      runtime.push(...Object.keys({ ...j.dependencies, ...j.require }).filter((d) => d !== "php"));
      dev.push(...Object.keys({ ...j.devDependencies, ...j["require-dev"] }));
      Object.assign(scripts, j.scripts ?? {});
    } catch {
      // manifiesto inválido
    }
  }
  const topDirs = (re: RegExp) => [...new Set(visible.map((f) => posix.dirname(f)).filter((d) => d !== "." && re.test(d)).map((d) => d.split("/").slice(0, 2).join("/")))].sort().slice(0, 12);
  const entryPoints = visible
    .filter((f) => /(^|\/)(index|main|app|server)\.(php|js|ts|py|go|rb)$|(^|\/)manage\.py$|(^|\/)gulpfile\.js$/.test(f) && f.split("/").length <= 3)
    // Las vistas y plantillas se llaman index.php a menudo, pero no son puntos de entrada.
    .filter((f) => !/(^|\/)(views?|templates?|components?|pages|layouts?)\//.test(f))
    .slice(0, 8);
  return {
    name,
    description,
    readme: readme?.replace(/<!--[\s\S]*?-->/g, "").trim().slice(0, 1500),
    stack,
    dependencies: { runtime: [...new Set(runtime)].slice(0, 30), dev: [...new Set(dev)].slice(0, 30) },
    scripts,
    tree: renderTree(visible),
    frontend: topDirs(FRONTEND_DIR),
    backend: topDirs(BACKEND_DIR),
    routes: routes.slice(0, 40),
    entryPoints,
  };
}

/** Árbol de carpetas (2 niveles) con el número de archivos de cada una. */
export function renderTree(files: string[], depth = 2, maxLines = 60): string {
  const counts = new Map<string, number>();
  const rootFiles: string[] = [];
  for (const f of files) {
    const parts = f.split("/");
    if (parts.length === 1) rootFiles.push(f);
    for (let d = 1; d <= Math.min(depth, parts.length - 1); d++) {
      const key = parts.slice(0, d).join("/");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const lines = [...counts.keys()]
    .sort()
    .map((k) => `${"  ".repeat(k.split("/").length - 1)}${k.split("/").pop()}/  (${counts.get(k)})`);
  lines.push(...rootFiles.slice(0, 15));
  return lines.slice(0, maxLines).join("\n") + (lines.length > maxLines ? "\n…" : "");
}

export function projectContextRequest(facts: ProjectFacts, outlines: string[], lang: string): ChatRequest {
  const parts = [
    `Project: ${facts.name}${facts.description ? ` — ${facts.description}` : ""}`,
    `Languages: ${facts.stack.languages.map((l) => `${l.label} (${l.files})`).join(", ")}`,
    `Dependencies: ${[...facts.dependencies.runtime, ...facts.dependencies.dev].join(", ") || "none"}`,
    `Frontend folders: ${facts.frontend.join(", ") || "?"}`,
    `Backend folders: ${facts.backend.join(", ") || "?"}`,
    `Routes: ${facts.routes.join(", ") || "none"}`,
    `Entry points: ${facts.entryPoints.join(", ") || "?"}`,
    `Folder tree:\n${facts.tree}`,
  ];
  if (facts.readme) parts.push(`README:\n${facts.readme}`);
  if (outlines.length) parts.push(`Main classes and functions:\n${outlines.join("\n\n").slice(0, 6000)}`);
  return {
    system: [
      "You document a software project for a developer (or an AI assistant) who has never seen it.",
      "Using ONLY the facts and code outlines given (do not invent features that are not in the routes or classes),",
      "write exactly these Markdown sections, each title on its own line followed by a blank line and its content:",
      "",
      "## De qué trata",
      "",
      "(2-4 sentences)",
      "",
      "## Objetivo",
      "",
      "(what problem it solves and for whom, 2-3 sentences; say it is inferred if not explicit)",
      "",
      "## Arquitectura",
      "",
      "(3-6 bullets '- ': how the app is organized, e.g. MVC, SPA, API, and the request flow)",
      "",
      "## Frontend",
      "",
      "(bullets: folders, technologies, how views and assets are built)",
      "",
      "## Backend",
      "",
      "(bullets: the folders with most files first, main controllers/models and what they do, data storage)",
      "",
      "## Flujo principal",
      "",
      "(numbered steps '1. ', one per line, inferred from routes and classes)",
      "",
      `Write in ${lang}. Reply with ONLY the sections.`,
    ].join("\n"),
    user: parts.join("\n\n"),
    maxTokens: 1500,
    temperature: 0.2,
  };
}

/**
 * Ordena el Markdown del modelo: «## Título — texto» → título y párrafo; pasos «1. … 2. …»
 * en una sola línea → un paso por línea.
 */
export function tidyNarrative(text: string): string {
  return text
    .replace(/^```(?:markdown|md)?\n|```\s*$/g, "")
    .replace(/^(#{2,3} [^\n—:]+?)[ \t]*[—:-][ \t]+(\S[^\n]*)$/gm, "$1\n\n$2")
    // «Pasos: 1. … 2. …» en una línea: un paso por línea (solo si hay al menos dos pasos).
    .replace(/^(.*?\S)[ \t]+(1\.[ \t].*[ \t]2\.[ \t].*)$/gm, "$1\n$2")
    .replace(/(\S)[ \t]+(?=(?:[2-9]|1\d)\.[ \t]+[A-ZÁÉÍÓÚÑ¿¡])/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Documento final PROJECT-CONTEXT.md: texto del modelo + datos medidos. */
export function projectContextDoc(facts: ProjectFacts, narrative: string, date: Date): string {
  const s = facts.stack;
  const deps = (list: string[]) => (list.length ? list.map((d) => `\`${d}\``).join(", ") : "—");
  const out = [
    `# ${facts.name} — contexto del proyecto`,
    "",
    `> Generado con GhostCode el ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}. Pégalo al inicio de una conversación con una IA para que entienda el proyecto.`,
    "",
    tidyNarrative(narrative),
    "",
    "## Lenguajes y herramientas",
    "",
    "| Lenguaje | Archivos |",
    "|---|---|",
    ...s.languages.slice(0, 12).map((l) => `| ${l.label} | ${l.files} |`),
    "",
    `- **Dependencias:** ${deps(facts.dependencies.runtime)}`,
    `- **Dependencias de desarrollo:** ${deps(facts.dependencies.dev)}`,
  ];
  if (Object.keys(facts.scripts).length) {
    out.push("", "## Cómo ejecutarlo", "", ...Object.entries(facts.scripts).map(([k, v]) => `- \`${k}\`: \`${v}\``));
  }
  out.push("", "## Estructura", "", "```", facts.tree, "```");
  if (facts.frontend.length || facts.backend.length) {
    out.push("", `- **Frontend:** ${facts.frontend.map((d) => `\`${d}/\``).join(", ") || "—"}`, `- **Backend:** ${facts.backend.map((d) => `\`${d}/\``).join(", ") || "—"}`);
  }
  if (facts.entryPoints.length) out.push(`- **Puntos de entrada:** ${facts.entryPoints.map((e) => `\`${e}\``).join(", ")}`);
  if (facts.routes.length) out.push("", "## Rutas", "", ...facts.routes.map((r) => `- \`${r}\``));
  return out.join("\n") + "\n";
}

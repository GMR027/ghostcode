/**
 * Recomendación de extensiones de VS Code según lo que usa el proyecto: lenguajes
 * (por extensión de archivo) y herramientas (por los manifiestos: package.json,
 * composer.json, requirements.txt, go.mod…).
 */

const LANGUAGES: [RegExp, string, string][] = [
  [/\.blade\.php$/i, "blade", "Blade"],
  [/\.php$/i, "php", "PHP"],
  [/\.(m?js|cjs|jsx)$/i, "javascript", "JavaScript"],
  [/\.(ts|tsx|mts|cts)$/i, "typescript", "TypeScript"],
  [/\.py$/i, "python", "Python"],
  [/\.ipynb$/i, "jupyter", "Jupyter"],
  [/\.go$/i, "go", "Go"],
  [/\.rs$/i, "rust", "Rust"],
  [/\.java$/i, "java", "Java"],
  [/\.kts?$/i, "kotlin", "Kotlin"],
  [/\.cs$/i, "csharp", "C#"],
  [/\.(c|h)$/i, "c", "C"],
  [/\.(cpp|cc|cxx|hpp|hh)$/i, "cpp", "C++"],
  [/\.rb$/i, "ruby", "Ruby"],
  [/\.swift$/i, "swift", "Swift"],
  [/\.dart$/i, "dart", "Dart"],
  [/\.lua$/i, "lua", "Lua"],
  [/\.exs?$/i, "elixir", "Elixir"],
  [/\.r$/i, "r", "R"],
  [/\.vue$/i, "vue", "Vue"],
  [/\.svelte$/i, "svelte", "Svelte"],
  [/\.s[ac]ss$/i, "scss", "Sass"],
  [/\.css$/i, "css", "CSS"],
  [/\.html?$/i, "html", "HTML"],
  [/\.sql$/i, "sql", "SQL"],
  [/\.(sh|bash)$/i, "shell", "Shell"],
  [/\.ps1$/i, "powershell", "PowerShell"],
  [/\.ya?ml$/i, "yaml", "YAML"],
  [/\.md$/i, "markdown", "Markdown"],
];

/** Dependencia (npm, composer, pip…) → etiqueta. */
const DEPENDENCIES: [RegExp, string][] = [
  [/^react$/, "react"], [/^next$/, "react"], [/^react-native$/, "react"], [/^vue$/, "vue"], [/^nuxt$/, "vue"],
  [/^svelte$/, "svelte"], [/^@angular\/core$/, "angular"], [/^tailwindcss$/, "tailwind"], [/^eslint$/, "eslint"],
  [/^prettier$/, "prettier"], [/^jest$/, "jest"], [/^vitest$/, "vitest"], [/^@playwright\/test$/, "playwright"],
  [/^(prisma|@prisma\/client)$/, "prisma"], [/^(mysql2?|pg|sqlite3|mongoose|sequelize|typeorm|knex)$/, "database"],
  [/^astro$/, "astro"], [/^laravel\/framework$/, "laravel"], [/^phpunit\/phpunit$/, "phpunit"],
  [/^(django)$/i, "django"], [/^(flask)$/i, "flask"], [/^(fastapi)$/i, "fastapi"], [/^(pytest)$/i, "pytest"],
  [/^(jupyter|notebook|ipykernel)$/i, "jupyter"], [/^(psycopg2?|pymysql|sqlalchemy|mysql-connector-python)$/i, "database"],
];

/** Archivo presente → etiqueta. */
const FILES: [RegExp, string][] = [
  [/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i, "docker"],
  [/(^|\/)\.env(\..+)?$/, "dotenv"],
  [/(^|\/)\.editorconfig$/, "editorconfig"],
  [/(^|\/)tailwind\.config\.\w+$/, "tailwind"],
  [/(^|\/)pubspec\.yaml$/, "flutter"],
  [/(^|\/)\.eslintrc(\.\w+)?$|(^|\/)eslint\.config\.\w+$/, "eslint"],
  [/(^|\/)\.prettierrc(\.\w+)?$/, "prettier"],
];

export interface Stack {
  /** Lenguajes por número de archivos (de más a menos). */
  languages: { id: string; label: string; files: number }[];
  tags: Set<string>;
}

/**
 * `manifests`: contenido de package.json, composer.json, requirements.txt, pyproject.toml…
 * (clave = nombre del archivo). `usesSql`: el código hace consultas a una base de datos.
 */
export function detectStack(files: string[], manifests: Record<string, string>, usesSql = false, hasGit = false): Stack {
  const counts = new Map<string, { label: string; files: number }>();
  const tags = new Set<string>();
  for (const f of files) {
    // Código de terceros y compilado: no dice qué lenguajes escribe el usuario.
    if (/(^|\/)(node_modules|vendor|\.git|dist|build|out|coverage|\.venv|venv)\//.test(f)) continue;
    for (const [re, id, label] of LANGUAGES) {
      if (re.test(f)) {
        const c = counts.get(id) ?? { label, files: 0 };
        c.files++;
        counts.set(id, c);
        break;
      }
    }
    for (const [re, tag] of FILES) if (re.test(f)) tags.add(tag);
  }
  const deps: string[] = [];
  for (const [name, text] of Object.entries(manifests)) {
    if (/package\.json$|composer\.json$/.test(name)) {
      try {
        const j = JSON.parse(text);
        deps.push(...Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.require, ...j["require-dev"] }));
      } catch {
        // manifiesto inválido: ignorar
      }
    } else {
      // requirements.txt / pyproject.toml / Gemfile: un paquete por línea o entre comillas.
      deps.push(...(text.match(/^[A-Za-z][\w.-]*|"[A-Za-z][\w.-]*/gm) ?? []).map((d) => d.replace(/^"/, "")));
    }
  }
  for (const d of deps) for (const [re, tag] of DEPENDENCIES) if (re.test(d)) tags.add(tag);
  if (usesSql || counts.has("sql")) tags.add("database");
  if (hasGit) tags.add("git");
  for (const id of counts.keys()) tags.add(id);
  if (counts.has("blade")) tags.add("php");
  return {
    languages: [...counts.entries()].map(([id, c]) => ({ id, ...c })).sort((a, b) => b.files - a.files),
    tags,
  };
}

export interface ExtensionInfo {
  id: string;
  name: string;
  why: string;
  /** Se recomienda si el proyecto tiene alguna de estas etiquetas ("*" = siempre). */
  tags: string[];
}

export const CATALOG: ExtensionInfo[] = [
  { id: "bmewburn.vscode-intelephense-client", name: "PHP Intelephense", why: "Autocompletado, navegación y errores de PHP", tags: ["php"] },
  { id: "xdebug.php-debug", name: "PHP Debug", why: "Depurar PHP paso a paso con Xdebug", tags: ["php"] },
  { id: "onecentlab.laravel-blade", name: "Laravel Blade Snippets", why: "Resaltado y fragmentos para plantillas Blade", tags: ["blade", "laravel"] },
  { id: "dbaeumer.vscode-eslint", name: "ESLint", why: "Detecta errores y malas prácticas en JavaScript/TypeScript", tags: ["javascript", "typescript", "eslint"] },
  { id: "esbenp.prettier-vscode", name: "Prettier", why: "Formato consistente para JS, TS, CSS, HTML y más", tags: ["javascript", "typescript", "scss", "css", "vue", "prettier"] },
  { id: "dsznajder.es7-react-js-snippets", name: "ES7+ React snippets", why: "Fragmentos para componentes y hooks de React", tags: ["react"] },
  { id: "Vue.volar", name: "Vue - Official", why: "Soporte oficial de Vue (plantillas, tipos, errores)", tags: ["vue"] },
  { id: "svelte.svelte-vscode", name: "Svelte for VS Code", why: "Soporte de Svelte", tags: ["svelte"] },
  { id: "Angular.ng-template", name: "Angular Language Service", why: "Plantillas de Angular con autocompletado y errores", tags: ["angular"] },
  { id: "astro-build.astro-vscode", name: "Astro", why: "Soporte de archivos .astro", tags: ["astro"] },
  { id: "bradlc.vscode-tailwindcss", name: "Tailwind CSS IntelliSense", why: "Autocompleta y previsualiza clases de Tailwind", tags: ["tailwind"] },
  { id: "ecmel.vscode-html-css", name: "HTML CSS Support", why: "Autocompleta en el HTML las clases definidas en tu CSS", tags: ["html", "php", "css", "scss"] },
  { id: "formulahendry.auto-rename-tag", name: "Auto Rename Tag", why: "Renombra la etiqueta de cierre al cambiar la de apertura", tags: ["html", "php", "vue", "react"] },
  { id: "ritwickdey.LiveServer", name: "Live Server", why: "Servidor local con recarga automática para páginas HTML", tags: ["html"] },
  { id: "ms-python.python", name: "Python", why: "Ejecutar, depurar y entornos virtuales de Python", tags: ["python"] },
  { id: "ms-python.vscode-pylance", name: "Pylance", why: "Autocompletado y tipos de Python", tags: ["python"] },
  { id: "charliermarsh.ruff", name: "Ruff", why: "Linter y formateador de Python muy rápido", tags: ["python"] },
  { id: "ms-toolsai.jupyter", name: "Jupyter", why: "Notebooks de Jupyter dentro de VS Code", tags: ["jupyter"] },
  { id: "golang.go", name: "Go", why: "Soporte oficial de Go (gopls, pruebas, depuración)", tags: ["go"] },
  { id: "rust-lang.rust-analyzer", name: "rust-analyzer", why: "Soporte de Rust", tags: ["rust"] },
  { id: "vscjava.vscode-java-pack", name: "Extension Pack for Java", why: "Java: proyectos Maven/Gradle, depuración y pruebas", tags: ["java"] },
  { id: "fwcd.kotlin", name: "Kotlin", why: "Soporte de Kotlin", tags: ["kotlin"] },
  { id: "ms-dotnettools.csdevkit", name: "C# Dev Kit", why: "Proyectos .NET y C#", tags: ["csharp"] },
  { id: "ms-vscode.cpptools-extension-pack", name: "C/C++ Extension Pack", why: "Compilar, depurar y navegar código C/C++", tags: ["c", "cpp"] },
  { id: "Shopify.ruby-lsp", name: "Ruby LSP", why: "Soporte de Ruby", tags: ["ruby"] },
  { id: "swiftlang.swift-vscode", name: "Swift", why: "Soporte de Swift", tags: ["swift"] },
  { id: "Dart-Code.flutter", name: "Flutter", why: "Desarrollo con Flutter y Dart", tags: ["flutter", "dart"] },
  { id: "sumneko.lua", name: "Lua", why: "Soporte de Lua", tags: ["lua"] },
  { id: "JakeBecker.elixir-ls", name: "ElixirLS", why: "Soporte de Elixir", tags: ["elixir"] },
  { id: "REditorSupport.r", name: "R", why: "Soporte de R", tags: ["r"] },
  { id: "mtxr.sqltools", name: "SQLTools", why: "Conectarte a tu base de datos y probar consultas desde VS Code", tags: ["database", "sql"] },
  { id: "Prisma.prisma", name: "Prisma", why: "Esquemas de Prisma", tags: ["prisma"] },
  { id: "Orta.vscode-jest", name: "Jest", why: "Ejecuta y depura pruebas de Jest", tags: ["jest"] },
  { id: "vitest.explorer", name: "Vitest", why: "Ejecuta y depura pruebas de Vitest", tags: ["vitest"] },
  { id: "ms-playwright.playwright", name: "Playwright Test", why: "Pruebas de extremo a extremo", tags: ["playwright"] },
  { id: "ms-azuretools.vscode-containers", name: "Container Tools", why: "Dockerfile y docker compose", tags: ["docker"] },
  { id: "mikestead.dotenv", name: "DotENV", why: "Resaltado de archivos .env", tags: ["dotenv"] },
  { id: "EditorConfig.EditorConfig", name: "EditorConfig", why: "Respeta el .editorconfig del proyecto", tags: ["editorconfig"] },
  { id: "redhat.vscode-yaml", name: "YAML", why: "Validación y autocompletado de YAML", tags: ["yaml"] },
  { id: "yzhang.markdown-all-in-one", name: "Markdown All in One", why: "Atajos, índice y vista previa de Markdown", tags: ["markdown"] },
  { id: "eamodio.gitlens", name: "GitLens", why: "Quién cambió cada línea y por qué, historial de Git", tags: ["git"] },
  { id: "christian-kohler.path-intellisense", name: "Path Intellisense", why: "Autocompleta rutas de archivos al escribirlas", tags: ["html", "php", "javascript", "typescript", "css", "scss"] },
  { id: "usernamehw.errorlens", name: "Error Lens", why: "Muestra los errores en la misma línea del código", tags: ["*"] },
];

export interface Recommendation extends ExtensionInfo {
  installed: boolean;
  /** Qué del proyecto la justifica (p. ej. "PHP · 12 archivos"). */
  because: string;
  score: number;
}

export function recommend(stack: Stack, isInstalled: (id: string) => boolean): Recommendation[] {
  const weight = new Map(stack.languages.map((l) => [l.id, l.files]));
  const label = new Map(stack.languages.map((l) => [l.id, `${l.label} · ${l.files} archivo${l.files === 1 ? "" : "s"}`]));
  const out: Recommendation[] = [];
  for (const ext of CATALOG) {
    const hits = ext.tags.filter((t) => t === "*" || stack.tags.has(t));
    if (!hits.length) continue;
    // Live Server solo tiene sentido en sitios HTML sin framework ni servidor propio.
    if (ext.id === "ritwickdey.LiveServer" && ["php", "react", "vue", "svelte", "angular"].some((t) => stack.tags.has(t))) continue;
    const because = hits[0] === "*" ? "Útil en cualquier proyecto" : hits.map((h) => label.get(h) ?? TAG_LABELS[h] ?? h).join(", ");
    const score = hits.reduce((s, h) => s + (h === "*" ? 1 : (weight.get(h) ?? 5) + 10), 0);
    out.push({ ...ext, installed: isInstalled(ext.id), because, score });
  }
  return out.sort((a, b) => Number(a.installed) - Number(b.installed) || b.score - a.score);
}

const TAG_LABELS: Record<string, string> = {
  database: "consultas a base de datos", git: "repositorio Git", docker: "Docker", dotenv: "archivo .env",
  react: "React", vue: "Vue", tailwind: "Tailwind", eslint: "ESLint", prettier: "Prettier", jest: "Jest",
  vitest: "Vitest", laravel: "Laravel", django: "Django", flask: "Flask", fastapi: "FastAPI", flutter: "Flutter",
};

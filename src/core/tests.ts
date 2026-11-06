/**
 * Localiza el test de un archivo y decide cómo ejecutarlo. Trabaja con las
 * convenciones habituales de cada ecosistema; no ejecuta nada por sí mismo.
 */

import { extractDeclarations } from "./declarations";

const path = {
  dirname: (p: string) => p.slice(0, p.lastIndexOf("/")),
  basename: (p: string) => p.slice(p.lastIndexOf("/") + 1),
  extname: (p: string) => {
    const b = p.slice(p.lastIndexOf("/") + 1);
    const dot = b.lastIndexOf(".");
    return dot > 0 ? b.slice(dot) : "";
  },
  join: (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
};

function withoutExt(file: string): string {
  const ext = path.extname(file);
  return ext ? file.slice(0, -ext.length) : file;
}

/** Posibles rutas del test para un archivo, de la más probable a la menos. */
export function candidateTestPaths(sourcePath: string): string[] {
  const ext = path.extname(sourcePath).toLowerCase();
  const dir = path.dirname(sourcePath);
  const base = path.basename(withoutExt(sourcePath));
  const out: string[] = [];
  const add = (p: string) => {
    if (p && !out.includes(p)) out.push(p);
  };

  if ([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte"].includes(ext)) {
    add(`${dir}/${base}.test${ext}`);
    add(`${dir}/${base}.spec${ext}`);
    add(`${dir}/__tests__/${base}.test${ext}`);
    add(`${dir}/__tests__/${base}.spec${ext}`);
    for (const root of ["test", "tests", "src/test", "src/__tests__"]) {
      const rel = dir.startsWith("src/") ? dir.slice(4) : dir;
      add(`${root}/${rel ? `${rel}/` : ""}${base}.test${ext}`);
      add(`${root}/${rel ? `${rel}/` : ""}${base}.spec${ext}`);
      add(`${root}/${base}.test${ext}`);
    }
  } else if (ext === ".py") {
    add(`${dir}/test_${base}.py`);
    add(`${dir}/${base}_test.py`);
    for (const root of ["tests", "test"]) {
      add(`${root}/test_${base}.py`);
      add(`${root}/${base}_test.py`);
      add(`${root}/${dir ? `${dir}/` : ""}test_${base}.py`);
    }
  } else if (ext === ".php") {
    add(`${dir}/${base}Test.php`);
    add(`tests/${base}Test.php`);
    add(`tests/Feature/${base}Test.php`);
    add(`tests/Unit/${base}Test.php`);
  } else if (ext === ".go") {
    add(`${dir}/${base}_test.go`);
  } else if (ext === ".rb") {
    add(`${dir}/${base}_spec.rb`);
    add(`spec/${base}_spec.rb`);
    add(`test/test_${base}.rb`);
  } else if (".java".includes(ext) || ext === ".kt") {
    const testPath = sourcePath.replace("/src/main/", "/src/test/").replace(/\.(java|kt)$/, `Test${ext}`);
    add(testPath);
  } else if (ext === ".cs") {
    add(`${dir}/${base}Tests.cs`);
    add(`${dir}/${base}Test.cs`);
  }
  return out;
}

export interface TestFramework {
  id: string;
  label: string;
  /** Comando para ejecutar un archivo de test concreto (o todo si no hay). */
  command: (testFile?: string) => string;
}

function hasDep(pkg: string | undefined, name: string): boolean {
  return new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`).test(pkg ?? "");
}

/** Detecta el framework de tests a partir de manifiestos y archivos del proyecto. */
export function detectTestFramework(
  files: Iterable<string>,
  packageJson?: string,
  composerJson?: string,
): TestFramework | undefined {
  const list = [...files];
  const has = (re: RegExp) => list.some((f) => re.test(f));
  const quote = (file?: string) => (file ? ` "${file}"` : "");

  if (packageJson) {
    if (hasDep(packageJson, "vitest") || /"test"\s*:\s*"[^"]*vitest/.test(packageJson))
      return { id: "vitest", label: "Vitest", command: (f) => `npx vitest run${quote(f)}` };
    if (hasDep(packageJson, "jest") || /"test"\s*:\s*"[^"]*jest/.test(packageJson))
      return { id: "jest", label: "Jest", command: (f) => `npx jest${quote(f)}` };
    if (hasDep(packageJson, "mocha") || /"test"\s*:\s*"[^"]*mocha/.test(packageJson))
      return { id: "mocha", label: "Mocha", command: (f) => `npx mocha${quote(f)}` };
    if (hasDep(packageJson, "ava")) return { id: "ava", label: "AVA", command: (f) => `npx ava${quote(f)}` };
    if (/"test"\s*:/.test(packageJson)) {
      const script = /"test"\s*:\s*"([^"]+)"/.exec(packageJson)?.[1];
      if (script) return { id: "npm", label: "npm test", command: () => `npm test` };
    }
  }
  if (composerJson && (hasDep(composerJson, "phpunit/phpunit") || has(/vendor\/bin\/phpunit$/)))
    return { id: "phpunit", label: "PHPUnit", command: (f) => `vendor/bin/phpunit${quote(f)}` };
  if (has(/(^|\/)pytest\.ini$|(^|\/)conftest\.py$|(^|\/)test_.*\.py$|(^|\/).*_test\.py$/))
    return { id: "pytest", label: "pytest", command: (f) => `pytest${quote(f)}` };
  if (has(/(^|\/)go\.mod$/)) return { id: "go", label: "go test", command: () => "go test ./..." };
  if (has(/(^|\/)Cargo\.toml$/)) return { id: "cargo", label: "cargo test", command: () => "cargo test" };
  if (has(/(^|\/)Gemfile$/) && has(/(^|\/)spec\//)) return { id: "rspec", label: "RSpec", command: (f) => `bundle exec rspec${quote(f)}` };
  if (has(/(^|\/).*\.csproj$/)) return { id: "dotnet", label: ".NET test", command: () => "dotnet test" };
  if (has(/(^|\/)pom\.xml$/)) return { id: "maven", label: "Maven", command: () => "mvn test" };
  return undefined;
}

/** Elige el primer test que exista de los candidatos. */
export function findTestFile(sourcePath: string, files: Iterable<string>): string | undefined {
  const existing = new Set([...files].map((f) => f.replace(/\\/g, "/")));
  return candidateTestPaths(sourcePath).find((p) => existing.has(p));
}

export interface UntestedSymbol {
  name: string;
  line: number;
  kind: string;
}

/** Funciones del archivo cuyo nombre no aparece en el test. */
export function untestedSymbols(sourceText: string, testText: string | undefined, max = 40): UntestedSymbol[] {
  const out: UntestedSymbol[] = [];
  for (const d of extractDeclarations(sourceText)) {
    if (d.kind !== "function" || d.container) continue;
    if (d.name.length < 3 || ["constructor", "main"].includes(d.name)) continue;
    if (testText && new RegExp(`\\b${d.name.replace(/[$]/g, "\\$&")}\\b`).test(testText)) continue;
    out.push({ name: d.name, line: d.line, kind: d.kind });
    if (out.length >= max) break;
  }
  return out;
}

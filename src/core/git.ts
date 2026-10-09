import type { ChatRequest } from "./types";

export interface RemoteInfo {
  host: string;
  owner: string;
  repo: string;
  isGitHub: boolean;
  /** URL web del repositorio (si el host es conocido). */
  web?: string;
}

/** git@github.com:dueño/repo.git · https://github.com/dueño/repo · ssh://git@host:22/grupo/sub/repo.git */
export function parseRemote(url: string | undefined): RemoteInfo | undefined {
  if (!url) return undefined;
  const m =
    /^(?:[\w+-]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return undefined;
  const host = m[1].toLowerCase();
  const parts = m[2].split("/").filter(Boolean);
  if (parts.length < 2) return undefined;
  const repo = parts.pop()!;
  const owner = parts.join("/");
  const isGitHub = /(^|\.)github\.com$/.test(host);
  const web = /github\.com|gitlab\.com|bitbucket\.org|codeberg\.org/.test(host) ? `https://${host}/${owner}/${repo}` : undefined;
  return { host, owner, repo, isGitHub, web };
}

const LANGUAGE_NAMES: Record<string, string> = {
  es: "Spanish", en: "English", pt: "Portuguese", fr: "French", de: "German", it: "Italian",
};

/** Recorta un diff largo manteniendo la cabecera de cada archivo y el principio de sus cambios. */
export function truncateDiff(diff: string, max = 12_000): string {
  if (diff.length <= max) return diff;
  const files = diff.split(/^(?=diff --git )/m);
  const per = Math.max(400, Math.floor(max / Math.max(1, files.length)));
  const out = files.map((f) => (f.length > per ? f.slice(0, per) + "\n[… cambios recortados …]\n" : f)).join("");
  return out.length > max ? out.slice(0, max) + "\n[… diff recortado …]" : out;
}

export function commitRequest(
  diff: string,
  newFiles: { path: string; head: string }[],
  branch: string | undefined,
  uiLanguage: string,
): ChatRequest {
  const lang = LANGUAGE_NAMES[uiLanguage.slice(0, 2).toLowerCase()] ?? "English";
  const parts = [`Branch: ${branch ?? "(unknown)"}`];
  if (diff.trim()) parts.push("<diff>", truncateDiff(diff), "</diff>");
  if (newFiles.length) {
    parts.push("New files:");
    for (const f of newFiles) parts.push(`--- ${f.path}`, f.head);
  }
  return {
    system: [
      "Write a git commit message for the changes below.",
      "First line: at most 72 characters, imperative mood, with a Conventional Commits prefix",
      "(feat, fix, refactor, docs, test, chore, style or perf) and an optional scope, e.g. 'feat(api): …'.",
      "Then a blank line and 2 to 5 short bullet points starting with '- ' describing the main changes.",
      "Reply with ONLY the commit message: no fences, no quotes, no preamble.",
      `Write the description in ${lang} (keep the prefix in English).`,
    ].join("\n"),
    user: parts.join("\n"),
    maxTokens: 300,
    temperature: 0.2,
  };
}

/** Limpia la respuesta del modelo: ```, comillas, "Commit message:" y líneas en blanco de más. */
export function cleanCommitMessage(raw: string): string {
  let text = raw.replace(/```[a-z]*\n?|```/g, "").trim();
  text = text.replace(/^(?:\*\*)?(?:commit message|mensaje(?: de commit)?)(?:\*\*)?\s*:\s*/i, "");
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, ""));
  // Primera línea: el título; luego una sola línea en blanco antes del cuerpo.
  let [title, ...body] = lines;
  // El título no es una viñeta, y el tipo de Conventional Commits va en minúsculas.
  title = title
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^(feat|fix|refactor|docs|test|chore|style|perf|build|ci)(?=[(:!])/i, (t) => t.toLowerCase());
  const rest = body.join("\n").replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n");
  return rest ? `${title}\n\n${rest}` : title;
}

/** Información del cursor que necesita el post-procesado. */
export interface CursorContext {
  /** Texto de la línea actual antes del cursor. */
  lineBefore: string;
  /** Texto de la línea actual después del cursor. */
  lineAfter: string;
  /** Todo el texto después del cursor (recortado). */
  suffix: string;
  multiline: boolean;
}

const MAX_LINES = 40;
const OPENER_RE = /(?:[{([:]|=>|->|\bdo|\bthen|\belse)\s*$/;
const CLOSER_RE = /^\s*(?:[})\]]+[;,)]*|end\b.*|fi|done|esac|else\b.*|elif\b.*|catch\b.*|finally\b.*|except\b.*)\s*$/;
const SPECIAL_TOKENS_RE =
  /<\|(?:endoftext|file_sep|fim_prefix|fim_suffix|fim_middle|fim_pad|repo_name|im_end|im_start|EOT|end_of_text)\|>|<(?:fim_prefix|fim_suffix|fim_middle|file_sep|EOT)>|<｜(?:fim▁begin|fim▁hole|fim▁end|end▁of▁sentence)｜>/;

export function indentWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

/** Decide si conviene pedir varias líneas (como hace Copilot). */
export function shouldBeMultiline(lineBefore: string, lineAfter: string): boolean {
  // En medio de una línea con código a la derecha: solo completar la línea.
  if (lineAfter.trim() && !/^[\s)\]}>;,'"`]*$/.test(lineAfter)) return false;
  if (lineBefore.trim() === "") return true;
  return OPENER_RE.test(lineBefore);
}

function firstNonBlankLine(text: string): string | undefined {
  for (const l of text.split("\n")) if (l.trim()) return l;
  return undefined;
}

/**
 * Recorta la sugerencia al final del bloque lógico. Se llama durante el streaming
 * (`final=false`, la última línea puede estar incompleta) y al terminar (`final=true`).
 * Si `done` es true ya no hace falta seguir generando.
 */
export function trimToBlock(text: string, cc: CursorContext, final: boolean): { text: string; done: boolean } {
  const special = text.search(SPECIAL_TOKENS_RE);
  let done = false;
  if (special >= 0) {
    text = text.slice(0, special);
    done = true;
  }

  if (!cc.multiline) {
    const nl = text.indexOf("\n");
    if (nl >= 0) return { text: text.slice(0, nl), done: true };
    return { text, done };
  }

  const lines = text.split("\n");
  const baseIndent = indentWidth(cc.lineBefore);
  const opener = cc.lineBefore.trim() !== "" && OPENER_RE.test(cc.lineBefore);
  const suffixFirst = firstNonBlankLine(cc.suffix)?.trim();
  let sawDeeper = false;
  let prevBlank = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const complete = i < lines.length - 1 || final;
    if (i >= MAX_LINES) return { text: lines.slice(0, i).join("\n"), done: true };
    if (line.trim() === "") {
      // Tres líneas en blanco seguidas: el modelo ya está divagando.
      if (i >= 2 && lines[i - 1].trim() === "" && lines[i - 2].trim() === "" && complete) {
        return { text: lines.slice(0, i - 1).join("\n"), done: true };
      }
      prevBlank = true;
      continue;
    }
    // Esperar a tener al menos un carácter visible para medir la indentación.
    const ind = indentWidth(line);
    const cut = (keepThis: boolean) => ({ text: lines.slice(0, keepThis ? i + 1 : i).join("\n"), done: true });

    // El modelo empieza a reescribir el código que ya existe después del cursor.
    if (complete && suffixFirst && line.trim() === suffixFirst) return cut(false);

    if (opener) {
      if (ind <= baseIndent) {
        if (!complete) return { text, done };
        // Una llave/`end` de cierre que todavía no existe en el sufijo: incluirla.
        return cut(CLOSER_RE.test(line) && line.trim() !== suffixFirst);
      }
    } else {
      if (ind < baseIndent) return complete ? cut(false) : { text, done };
      if (ind > baseIndent) sawDeeper = true;
      else if (sawDeeper && prevBlank && complete) return cut(false);
    }
    prevBlank = false;
  }
  return { text, done };
}

/** Elimina ``` y repeticiones del texto ya escrito (típico de modelos de chat). */
function cleanChatOutput(text: string, lineBefore: string): string {
  const fence = text.match(/```[^\n]*\n([\s\S]*?)(?:\n?```|$)/);
  if (fence) text = fence[1];
  text = text.replace(/^<CURSOR>|<CURSOR>$/g, "");
  const before = lineBefore.trimStart();
  if (before) {
    if (text.startsWith(lineBefore)) text = text.slice(lineBefore.length);
    else if (text.trimStart().startsWith(before)) text = text.trimStart().slice(before.length);
  }
  return text;
}

function cutRepetition(text: string): string {
  const lines = text.split("\n");
  const t = lines.map((l) => l.trim());
  for (let i = 2; i < lines.length; i++) {
    const l = t[i];
    if (l && l.length > 2 && l === t[i - 1] && l === t[i - 2]) {
      return lines.slice(0, i - 1).join("\n");
    }
  }
  // Un bloque de 2–4 líneas que se repite tal cual: el modelo entró en bucle.
  for (let size = 2; size <= 4; size++) {
    for (let i = 0; i + 2 * size <= lines.length; i++) {
      const block = t.slice(i, i + size);
      if (block.join("").length > 6 && block.every((l, k) => l === t[i + size + k])) {
        return lines.slice(0, i + size).join("\n");
      }
    }
  }
  return text;
}

/** Puntuación de desbalance de paréntesis/comillas: 0 = perfecto. */
function imbalance(s: string): number {
  let p = 0, b = 0, c = 0, score = 0;
  for (const ch of s) {
    if (ch === "(") p++;
    else if (ch === ")") p--;
    else if (ch === "[") b++;
    else if (ch === "]") b--;
    else if (ch === "{") c++;
    else if (ch === "}") c--;
  }
  score = Math.abs(p) + Math.abs(b) + Math.abs(c);
  for (const q of ['"', "'", "`"]) {
    if ((s.split(q).length - 1) % 2) score++;
  }
  return score;
}

/**
 * Quita el solapamiento entre el final de la sugerencia y lo que ya hay a la
 * derecha del cursor, p. ej. `foo(|)` + "x)" → "x".
 */
function removeLineOverlap(text: string, cc: CursorContext): string {
  const after = cc.lineAfter.trimEnd();
  if (!after || text.includes("\n")) return text;
  let k = Math.min(after.length, text.length);
  while (k > 0 && !text.endsWith(after.slice(0, k))) k--;
  if (k === 0) return text;
  const trimmed = text.slice(0, text.length - k);
  const a = imbalance(cc.lineBefore + text + cc.lineAfter);
  const b = imbalance(cc.lineBefore + trimmed + cc.lineAfter);
  if (b < a || (b === a && k === after.length)) return trimmed;
  return text;
}

/** Quita las últimas líneas de la sugerencia si repiten las primeras del sufijo. */
function removeSuffixDuplicate(text: string, cc: CursorContext): string {
  const lines = text.split("\n");
  const suffixLines = cc.suffix.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!suffixLines.length || lines.length < 2) return text;
  for (let n = Math.min(lines.length - 1, suffixLines.length); n > 0; n--) {
    const tail = lines.slice(lines.length - n).map((l) => l.trim());
    if (tail.every((l, i) => l === suffixLines[i])) {
      return lines.slice(0, lines.length - n).join("\n");
    }
  }
  return text;
}

/** Limpieza final de la sugerencia. Devuelve undefined si no vale la pena mostrarla. */
export function finalizeCompletion(raw: string, cc: CursorContext, isChat: boolean): string | undefined {
  let text = raw.replace(/\r\n/g, "\n");
  if (isChat) text = cleanChatOutput(text, cc.lineBefore);
  text = trimToBlock(text, cc, true).text;
  text = cutRepetition(text);
  text = text
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\s+$/, "");
  if (cc.multiline) text = removeSuffixDuplicate(text, cc).replace(/\s+$/, "");
  text = removeLineOverlap(text, cc);
  if (!text.trim()) return undefined;
  // Nada nuevo: la sugerencia es exactamente lo que ya está a la derecha.
  if (cc.suffix.startsWith(text)) return undefined;
  return text;
}

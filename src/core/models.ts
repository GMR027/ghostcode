/** Hardware relevante para elegir modelo local. */
export interface Hardware {
  ramMb: number;
  /** VRAM de la GPU más grande (0 si no hay o no se pudo detectar). */
  vramMb: number;
  /** Fabricante o nombre de la GPU, si se detectó. */
  gpu?: string;
}

export interface ModelSuggestion {
  name: string;
  sizeGb: number;
  /** "completion" = autocompletado (FIM); "chat" = herramientas como las anotaciones. */
  use: "completion" | "chat";
  note: string;
  recommended: boolean;
}

// Modelos *base* con FIM, de menor a mayor (tamaños aproximados de Ollama, Q4).
const COMPLETION = [
  { name: "qwen2.5-coder:0.5b-base", sizeGb: 0.4 },
  { name: "qwen2.5-coder:1.5b-base", sizeGb: 1.0 },
  { name: "qwen2.5-coder:3b-base", sizeGb: 1.9 },
  { name: "qwen2.5-coder:7b-base", sizeGb: 4.7 },
];
// Modelos instruct (siguen instrucciones) para las anotaciones.
const CHAT = [
  { name: "qwen2.5-coder:1.5b", sizeGb: 1.0 },
  { name: "qwen2.5-coder:3b", sizeGb: 1.9 },
  { name: "qwen2.5-coder:7b", sizeGb: 4.7 },
];
const ALTERNATIVE = { name: "starcoder2:3b", sizeGb: 1.7 };

/**
 * Nivel 0–3 del modelo de autocompletado (mismos umbrales que scripts/install.sh).
 * Prima la latencia: en una RX 6600 de 8 GB el 3b-base tarda 1–4 s por sugerencia
 * y el 1.5b-base 0,2–1,2 s con calidad parecida.
 */
export function hardwareTier(hw: Hardware): number {
  if (hw.vramMb >= 16000) return 3;
  if (hw.vramMb >= 10000) return 2;
  if (hw.vramMb >= 3000 || hw.ramMb >= 16000) return 1;
  return 0;
}

/** Las anotaciones no necesitan ser instantáneas: modelo instruct más grande. */
function chatTier(hw: Hardware): number {
  if (hw.vramMb >= 12000) return 2;
  if (hw.vramMb >= 6000) return 1;
  return 0;
}

/** Al menos 3 modelos locales adecuados para el equipo, el recomendado primero. */
export function suggestModels(hw: Hardware): ModelSuggestion[] {
  const tier = hardwareTier(hw);
  const out: ModelSuggestion[] = [
    { ...COMPLETION[tier], use: "completion", note: "El mejor equilibrio para tu equipo", recommended: true },
  ];
  if (tier > 0) {
    out.push({ ...COMPLETION[tier - 1], use: "completion", note: "Más rápido, algo menos preciso", recommended: false });
  }
  if (tier < COMPLETION.length - 1) {
    out.push({ ...COMPLETION[tier + 1], use: "completion", note: "Más preciso, pero más lento en tu equipo", recommended: false });
  }
  if (tier >= 1) {
    out.push({ ...ALTERNATIVE, use: "completion", note: "Alternativa de otra familia (StarCoder2)", recommended: false });
  }
  out.push({ ...CHAT[chatTier(hw)], use: "chat", note: "Para las herramientas: documentar, arreglar, explicar…", recommended: true });
  return out;
}

/** Modelos base (FIM) que sirven para autocompletar pero no para seguir instrucciones. */
export function isCompletionOnly(name: string): boolean {
  return /-base\b|starcoder|-code\b|:code\b/i.test(name);
}

/**
 * Elige un modelo instruct instalado para las herramientas de chat:
 * primero la variante instruct del modelo de autocompletado, luego cualquier
 * instruct de código, luego cualquier instruct. undefined si solo hay modelos base.
 */
export function pickChatModel(installed: string[], completionModel: string): string | undefined {
  const sibling = completionModel.replace(/-base\b/, "");
  if (sibling !== completionModel && installed.includes(sibling)) return sibling;
  const instruct = installed.filter((m) => !isCompletionOnly(m) && !/embed/i.test(m));
  return instruct.find((m) => /coder|code/i.test(m)) ?? instruct[0];
}

export function describeHardware(hw: Hardware): string {
  const ram = `RAM ${(hw.ramMb / 1024).toFixed(0)} GB`;
  if (!hw.vramMb) return `${ram} · sin GPU dedicada detectada`;
  return `GPU ${hw.gpu ?? ""} ${(hw.vramMb / 1024).toFixed(0)} GB · ${ram}`.replace(/\s+/g, " ");
}

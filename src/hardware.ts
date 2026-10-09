import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import * as os from "node:os";
import type { Hardware } from "./core/models";

const PCI_VENDORS: Record<string, string> = { "0x10de": "NVIDIA", "0x1002": "AMD", "0x8086": "Intel" };

/** Detecta RAM y la GPU con más VRAM (NVIDIA, AMD en Linux y Apple Silicon). */
export async function detectHardware(): Promise<Hardware> {
  const ramMb = Math.round(os.totalmem() / 1024 / 1024);
  const gpus = [...(await nvidiaGpus()), ...(await sysfsGpus())];
  if (process.platform === "darwin" && process.arch === "arm64") {
    // Memoria unificada: la GPU puede usar ~2/3 de la RAM.
    gpus.push({ gpu: "Apple", vramMb: Math.round(ramMb * 0.66) });
  }
  const best = gpus.sort((a, b) => b.vramMb - a.vramMb)[0];
  return { ramMb, vramMb: best?.vramMb ?? 0, gpu: best?.gpu };
}

function nvidiaGpus(): Promise<{ gpu: string; vramMb: number }[]> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3000 },
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(
          stdout
            .trim()
            .split("\n")
            .map((l) => l.split(",").map((s) => s.trim()))
            .filter(([, mb]) => Number(mb) > 0)
            .map(([name, mb]) => ({ gpu: name.replace(/^NVIDIA\s+/i, "NVIDIA "), vramMb: Number(mb) })),
        );
      },
    );
  });
}

/** GPUs AMD (y otras con amdgpu) en Linux: /sys/class/drm/cardN/device/mem_info_vram_total. */
async function sysfsGpus(): Promise<{ gpu: string; vramMb: number }[]> {
  if (process.platform !== "linux") return [];
  const out: { gpu: string; vramMb: number }[] = [];
  const cards = await readdir("/sys/class/drm").catch(() => [] as string[]);
  for (const card of cards.filter((c) => /^card\d+$/.test(c))) {
    const dev = `/sys/class/drm/${card}/device`;
    const vram = Number(await readFile(`${dev}/mem_info_vram_total`, "utf8").catch(() => "0"));
    if (!vram) continue;
    const vendor = (await readFile(`${dev}/vendor`, "utf8").catch(() => "")).trim();
    out.push({ gpu: PCI_VENDORS[vendor] ?? "GPU", vramMb: Math.round(vram / 1024 / 1024) });
  }
  return out;
}

let cached: Promise<Hardware> | undefined;

/** detectHardware() memorizado: el hardware no cambia durante la sesión. */
export function getHardware(): Promise<Hardware> {
  return (cached ??= detectHardware());
}

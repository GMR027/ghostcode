import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";

const args = process.argv.slice(2);
const production = args.includes("--production");
const watch = args.includes("--watch");
const tests = args.includes("--tests");

/** @type {esbuild.BuildOptions} */
const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

if (tests) {
  // Pruebas unitarias: solo módulos puros (sin `vscode`).
  const entries = readdirSync("test")
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => `test/${f}`);
  await esbuild.build({ ...common, entryPoints: entries, outdir: "out/test", sourcemap: true });
} else {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    external: ["vscode"],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

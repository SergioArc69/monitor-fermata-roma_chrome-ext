import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

const commonOptions = {
  bundle: true,
  format: "esm",
  target: "chrome120",
  sourcemap: true,
  logLevel: "info",
  loader: { ".png": "dataurl" },
};

const buildOptions = [
  { ...commonOptions, entryPoints: ["src/background/index.ts"], outfile: "dist/background.js" },
  { ...commonOptions, entryPoints: ["src/popup/popup.ts"], outfile: "dist/popup.js" },
  // Bundles maplibre-gl/dist/maplibre-gl.css imported from map.ts into a sibling dist/map.css automatically.
  { ...commonOptions, entryPoints: ["src/fullpage/map.ts"], outfile: "dist/map.js" },
  { ...commonOptions, entryPoints: ["src/about/about.ts"], outfile: "dist/about.js" },
];

function copyStaticAssets() {
  cpSync("src/popup/popup.html", "dist/popup.html");
  cpSync("src/fullpage/map.html", "dist/map.html");
  cpSync("src/about/about.html", "dist/about.html");
  cpSync("src/privacy/privacy.html", "dist/privacy.html");
  // MapLibre GL JS resolves its worker at runtime relative to the main bundle's own URL
  // (import.meta.url), i.e. next to dist/map.js — esbuild doesn't know to bundle/copy it itself.
  // The worker file in turn imports a second chunk (code shared with the main thread) via a plain
  // relative import, so that has to be copied alongside it too.
  cpSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "dist/maplibre-gl-worker.mjs");
  cpSync("node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs", "dist/maplibre-gl-shared.mjs");
}

if (watch) {
  const contexts = await Promise.all(buildOptions.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  copyStaticAssets();
  console.log("Watching for changes...");
} else {
  await Promise.all(buildOptions.map((options) => esbuild.build(options)));
  copyStaticAssets();
  console.log("Build complete.");
}

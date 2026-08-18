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
  // leaflet.css references a few control/marker icons via url(); we don't use Leaflet's default
  // icon (every marker gets an explicit divIcon), but esbuild still needs a loader to resolve them.
  loader: { ".png": "dataurl" },
};

const buildOptions = [
  { ...commonOptions, entryPoints: ["src/background/index.ts"], outfile: "dist/background.js" },
  { ...commonOptions, entryPoints: ["src/popup/popup.ts"], outfile: "dist/popup.js" },
  // Bundles leaflet/dist/leaflet.css imported from map.ts into a sibling dist/map.css automatically.
  { ...commonOptions, entryPoints: ["src/fullpage/map.ts"], outfile: "dist/map.js" },
  { ...commonOptions, entryPoints: ["src/about/about.ts"], outfile: "dist/about.js" },
];

function copyStaticAssets() {
  cpSync("src/popup/popup.html", "dist/popup.html");
  cpSync("src/fullpage/map.html", "dist/map.html");
  cpSync("src/about/about.html", "dist/about.html");
  cpSync("src/privacy/privacy.html", "dist/privacy.html");
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

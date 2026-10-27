// Bundles the tests with esbuild (the sources use .js import suffixes on .ts files) and runs them
// with node's own test runner.
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";

const outfile = "dist-test/estimate.test.mjs";
await esbuild.build({
  entryPoints: ["test/estimate.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "warning",
});
const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);

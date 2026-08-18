// Statically generated from proto/gtfs-realtime.proto via `npx pbjs -t static-module` (see package.json
// scripts). Using the reflective protobuf.parse() API at runtime would use `new Function`/eval internally
// for codegen, which Manifest V3's Content-Security-Policy forbids ('unsafe-eval' is never allowed in
// extension pages, no matter what CSP we declare ourselves).
export { transit_realtime } from "./generated/gtfsRealtime.js";

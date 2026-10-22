import { build } from "esbuild";
import fs from "node:fs";
await build({
  entryPoints: ["src/worker.js"],
  outfile: "dist/worker.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  loader: { ".html": "text" },
});
console.log("Worker bundle:", fs.statSync("dist/worker.js").size, "bytes");

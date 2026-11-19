import { build } from "vite";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const watch = process.argv.includes("--watch") ? {} : null;
await rm(`${root}/dist`, { recursive: true, force: true });
await build({
  root,
  configFile: false,
  base: "./",
  build: {
    target: "chrome120",
    outDir: "dist",
    emptyOutDir: false,
    watch,
    rolldownOptions: {
      input: {
        popup: `${root}/popup.html`,
        offscreen: `${root}/offscreen.html`,
        lab: `${root}/lab.html`,
        background: `${root}/src/background.ts`,
      },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
    },
  },
  worker: { format: "es", rolldownOptions: { output: { assetFileNames: "ort/[name][extname]" } } },
});
await build({
  root,
  configFile: false,
  build: {
    target: "chrome120",
    outDir: "dist",
    emptyOutDir: false,
    watch,
    lib: {
      entry: `${root}/src/content.ts`,
      name: "SlopSpot",
      formats: ["iife"],
      fileName: () => "content.js",
    },
  },
});
await mkdir(`${root}/dist/ort`, { recursive: true });
for (const file of [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
]) {
  await cp(`${root}/node_modules/onnxruntime-web/dist/${file}`, `${root}/dist/ort/${file}`);
}
const { stdout } = await promisify(execFile)("pnpm", ["licenses", "list", "--prod", "--json"], {
  cwd: root,
});
for (const packages of Object.values(JSON.parse(stdout))) {
  for (const dependency of packages) {
    const directory = dependency.paths[0];
    if (!directory) continue;
    const destination = `${root}/dist/licenses/${dependency.name.replaceAll("/", "-")}`;
    for (const file of await readdir(directory)) {
      if (!/^(?:licen[cs]e|notice|thirdpartynotices)(?:\.|$)/iu.test(file)) continue;
      await mkdir(destination, { recursive: true });
      await cp(`${directory}/${file}`, `${destination}/${file}`, { recursive: true });
    }
  }
}
await cp(`${root}/NOTICE.md`, `${root}/dist/NOTICE.md`);
await cp(`${root}/LICENSE`, `${root}/dist/LICENSE`);
const manifest = {
  manifest_version: 3,
  name: "Slop Spot",
  version: "0.1.0",
  description: "Local AI involvement scores beside Slack messages. No message uploads or tracking.",
  minimum_chrome_version: "120",
  permissions: ["storage", "offscreen", "unlimitedStorage"],
  host_permissions: ["https://app.slack.com/*", "https://huggingface.co/*", "https://*.hf.co/*"],
  background: { service_worker: "background.js", type: "module" },
  action: { default_popup: "popup.html", default_title: "Slop Spot" },
  content_scripts: [
    { matches: ["https://app.slack.com/client/*"], js: ["content.js"], run_at: "document_idle" },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self' https://huggingface.co https://*.hf.co;",
  },
};
await writeFile(`${root}/dist/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Load dist/ at chrome://extensions. Reload the extension and Slack after rebuilds.");

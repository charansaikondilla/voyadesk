// Copies the in-browser passport reader (OCR) files into public/ so they ship with the app and work offline.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const out = path.resolve(import.meta.dirname, "../public/ocr");
mkdirSync(out, { recursive: true });
const tjs = path.dirname(require.resolve("tesseract.js/package.json"));
const core = path.dirname(require.resolve("tesseract.js-core/package.json"));
const data = path.dirname(require.resolve("@tesseract.js-data/eng/package.json"));
const files = [
  [path.join(tjs, "dist/worker.min.js"), "worker.min.js"],
  [path.join(core, "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js"],
  [path.join(core, "tesseract-core-lstm.wasm.js"), "tesseract-core-lstm.wasm.js"],
  [path.join(data, "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
];
for (const [from, name] of files) {
  if (!existsSync(path.join(out, name))) copyFileSync(from, path.join(out, name));
}
console.log(`[assets] passport reader files ready in public/ocr (${files.length})`);

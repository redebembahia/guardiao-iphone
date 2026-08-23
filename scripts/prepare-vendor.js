"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = path.resolve(__dirname, "..");
const MODEL_URL = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/por.traineddata";
const RAW_MODEL_SHA256 = "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb";

const EXPECTED = Object.freeze({
  "vendor/tesseract.min.js": "000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e",
  "vendor/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
  "vendor/core/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "vendor/core/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "vendor/lang/por.traineddata.gz": "8b875b5cedb7fc753eb01173df3b469c694c8bcb649180a351a13ebd18ab1832",
  "vendor/tesseract.min.js.LICENSE.txt": "cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2",
  "vendor/worker.min.js.LICENSE.txt": "45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac"
});

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function resolvePackageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

function copyFile(source, relativeTarget) {
  const target = path.join(ROOT, relativeTarget);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

async function readModel() {
  if (process.env.GUARDIAN_MODEL_FILE) {
    return fs.readFileSync(path.resolve(process.env.GUARDIAN_MODEL_FILE));
  }

  const response = await fetch(MODEL_URL, {
    redirect: "follow",
    headers: { "User-Agent": "guardiao-iphone-build/1.2.0" }
  });
  if (!response.ok) throw new Error(`Falha ao baixar o modelo português: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 3 * 1024 * 1024) throw new Error("O modelo português excedeu o limite esperado.");
  return bytes;
}

async function main() {
  const tesseractRoot = resolvePackageRoot("tesseract.js");
  const coreRoot = resolvePackageRoot("tesseract.js-core");

  copyFile(path.join(tesseractRoot, "dist/tesseract.min.js"), "vendor/tesseract.min.js");
  copyFile(path.join(tesseractRoot, "dist/worker.min.js"), "vendor/worker.min.js");
  copyFile(path.join(tesseractRoot, "dist/tesseract.min.js.LICENSE.txt"), "vendor/tesseract.min.js.LICENSE.txt");
  copyFile(path.join(tesseractRoot, "dist/worker.min.js.LICENSE.txt"), "vendor/worker.min.js.LICENSE.txt");
  copyFile(path.join(tesseractRoot, "LICENSE.md"), "vendor/licenses/APACHE-2.0.md");

  for (const file of [
    "tesseract-core-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-simd-lstm.wasm.js"
  ]) {
    copyFile(path.join(coreRoot, file), `vendor/core/${file}`);
  }

  const rawModel = await readModel();
  if (sha256(rawModel) !== RAW_MODEL_SHA256) {
    throw new Error("O hash do modelo português não corresponde ao arquivo oficial fixado.");
  }
  const compressedModel = zlib.gzipSync(rawModel, { level: 9, mtime: 0 });
  const modelTarget = path.join(ROOT, "vendor/lang/por.traineddata.gz");
  fs.mkdirSync(path.dirname(modelTarget), { recursive: true });
  fs.writeFileSync(modelTarget, compressedModel);

  for (const [relativePath, expectedHash] of Object.entries(EXPECTED)) {
    const actualHash = sha256(fs.readFileSync(path.join(ROOT, relativePath)));
    if (actualHash !== expectedHash) throw new Error(`Integridade inesperada em ${relativePath}`);
  }

  console.log(`✓ ${Object.keys(EXPECTED).length} componentes OCR preparados e verificados`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

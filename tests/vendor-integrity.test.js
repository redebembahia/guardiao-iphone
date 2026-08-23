"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXPECTED = {
  "vendor/tesseract.min.js": "000c27d9cd0def655f77b36c72a389c0ab13793aa31cb4d7aab56d09c0afbc7e",
  "vendor/worker.min.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
  "vendor/core/tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
  "vendor/core/tesseract-core-relaxedsimd-lstm.wasm.js": "861a536cf9ef8e63cb644d57bab39c388f37f7d6b6f60024b741c5f6b39a59b3",
  "vendor/core/tesseract-core-simd-lstm.wasm.js": "c58b46a4c796c0b8afccf77591d5b875b6896b45d402bbce8caa6f5362447b38",
  "vendor/lang/por.traineddata.gz": "8b875b5cedb7fc753eb01173df3b469c694c8bcb649180a351a13ebd18ab1832",
  "vendor/tesseract.min.js.LICENSE.txt": "cdf963ced7d25a0f98901a547647b4d6e2dbe0197fd78c87a059a87b0e542fe2",
  "vendor/worker.min.js.LICENSE.txt": "45f54171aeaa1d10c0c1a66f374b7bba1f02472b1487fbe892eec04f840002ac"
};

for (const [relativePath, expectedHash] of Object.entries(EXPECTED)) {
  const bytes = fs.readFileSync(path.join(ROOT, relativePath));
  const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.strictEqual(actualHash, expectedHash, `Integridade inesperada em ${relativePath}`);
}

console.log(`✓ ${Object.keys(EXPECTED).length} arquivos OCR e avisos legais íntegros`);

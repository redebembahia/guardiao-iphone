"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function makeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: "",
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        fillRect() {},
        drawImage() {},
        clearRect() {}
      };
    }
  };
}

let terminateCalls = 0;
const worker = {
  async setParameters() {},
  recognize() { return new Promise(() => {}); },
  async terminate() { terminateCalls += 1; }
};

const context = vm.createContext({
  console,
  Blob,
  AbortController,
  DOMException,
  Promise,
  Set,
  Error,
  Number,
  Math,
  Array,
  Object,
  String,
  URL,
  setTimeout,
  clearTimeout,
  createImageBitmap: async () => ({ width: 1290, height: 2796, close() {} }),
  document: { createElement: () => makeCanvas() },
  Tesseract: {
    OEM: { LSTM_ONLY: 1 },
    PSM: { SPARSE_TEXT: "11" },
    createWorker: async () => worker
  },
  GuardianParsers: { parseScreens: () => ({ fields: {}, sources: {}, issues: [] }) }
});

vm.runInContext(fs.readFileSync(require.resolve("../screenshot-import.js"), "utf8"), context);

async function main() {
  const scanner = context.GuardianScreenshotImport;
  const image = new Blob(["imagem"], { type: "image/png" });

  await assert.rejects(
    scanner.scan([image, image, image, image, image]),
    /no máximo 4 imagens/i
  );

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    scanner.scan([image], { signal: alreadyAborted.signal }),
    (error) => error?.name === "AbortError"
  );

  const controller = new AbortController();
  const startedAt = Date.now();
  const scan = scanner.scan([image], { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(scan, (error) => error?.name === "AbortError");
  assert.ok(Date.now() - startedAt < 500, "cancelamento deve rejeitar sem aguardar o OCR pendente");
  assert.ok(terminateCalls >= 1, "cancelamento deve encerrar o worker");

  console.log("✓ limites e cancelamento imediato do leitor validados");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

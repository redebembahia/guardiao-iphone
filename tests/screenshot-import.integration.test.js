"use strict";

const assert = require("node:assert/strict");

global.GuardianParsers = require("../screen-parsers.js");
global.createImageBitmap = async () => ({
  width: 1290,
  height: 2796,
  close() {}
});
global.document = {
  createElement(tagName) {
    assert.equal(tagName, "canvas");
    const context = {
      fillStyle: "#ffffff",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillRect() {},
      drawImage() {},
      clearRect() {}
    };
    return {
      width: 0,
      height: 0,
      getContext() {
        return context;
      }
    };
  }
};

require("../screenshot-import.js");

function testBlob() {
  const blob = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
  Object.defineProperty(blob, "name", { value: "battery-screen.png" });
  return blob;
}

async function testSuccessfulScan() {
  let terminated = 0;
  global.Tesseract = {
    OEM: { LSTM_ONLY: 1 },
    PSM: { SPARSE_TEXT: "11" },
    async createWorker() {
      return {
        async setParameters() {},
        async recognize() {
          return {
            data: {
              text: "Saúde da Bateria e Carregamento\nCapacidade Máxima 75%\nO gerenciamento de desempenho foi aplicado."
            }
          };
        },
        async terminate() {
          terminated += 1;
        }
      };
    }
  };

  const result = await global.GuardianScreenshotImport.scan([testBlob()]);
  assert.equal(result.fields.batteryCapacity, 75);
  assert.equal(result.fields.batteryStatus, "reduced");
  assert.equal(terminated, 1, "o worker deve ser encerrado após uma leitura normal");
}

async function testCancellationDoesNotHang() {
  let terminated = 0;
  global.Tesseract = {
    OEM: { LSTM_ONLY: 1 },
    PSM: { SPARSE_TEXT: "11" },
    async createWorker() {
      return {
        async setParameters() {},
        recognize() {
          return new Promise(() => {});
        },
        async terminate() {
          terminated += 1;
        }
      };
    }
  };

  const controller = new AbortController();
  const scan = global.GuardianScreenshotImport.scan([testBlob()], { signal: controller.signal });
  setTimeout(() => controller.abort(), 5);

  const outcome = await Promise.race([
    scan.then(
      () => ({ state: "resolved" }),
      (error) => ({ state: "rejected", error })
    ),
    new Promise((resolve) => setTimeout(() => resolve({ state: "timeout" }), 250))
  ]);

  assert.notEqual(outcome.state, "timeout", "cancelar não pode deixar a leitura pendente");
  assert.equal(outcome.state, "rejected");
  assert.equal(outcome.error?.name, "AbortError");
  assert.ok(terminated >= 1, "o worker deve ser encerrado ao cancelar");
}

async function main() {
  await testSuccessfulScan();
  await testCancellationDoesNotHang();
  console.log("✓ integração do importador conclui e cancela sem manter o OCR pendente");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

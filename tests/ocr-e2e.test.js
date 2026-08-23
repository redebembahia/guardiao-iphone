"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const sharp = require("sharp");
const { createWorker, OEM, PSM } = require("tesseract.js");
const parsers = require("../screen-parsers.js");

const MAX_EDGE = 1400;
const MAX_PIXELS = 8_000_000;

async function resizeLikeApp(filePath) {
  const image = sharp(filePath);
  const metadata = await image.metadata();
  assert.ok(metadata.width && metadata.height, "fixture deve ter dimensões válidas");

  const scale = Math.min(
    1,
    MAX_EDGE / Math.max(metadata.width, metadata.height),
    Math.sqrt(MAX_PIXELS / (metadata.width * metadata.height))
  );
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  return image
    .flatten({ background: "#ffffff" })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

async function main() {
  const cases = [
    {
      file: "storage-screen.svg",
      expected: {
        totalStorage: 256,
        freeStorage: 45.5,
        largestApp: "fotos",
        largestAppSize: 76
      }
    },
    {
      file: "battery-screen.svg",
      expected: {
        batteryCapacity: 75,
        batteryStatus: "reduced"
      }
    }
  ];

  const worker = await createWorker("por", OEM.LSTM_ONLY, {
    langPath: path.resolve(__dirname, "../vendor/lang"),
    corePath: path.resolve(__dirname, "../vendor/core"),
    cacheMethod: "none"
  });

  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    for (const testCase of cases) {
      const fixturePath = path.resolve(__dirname, "fixtures", testCase.file);
      const preparedImage = await resizeLikeApp(fixturePath);
      const recognition = await worker.recognize(preparedImage);
      const parsed = parsers.parseScreens([recognition.data.text]);

      for (const [field, expected] of Object.entries(testCase.expected)) {
        const actual = typeof parsed.fields[field] === "string"
          ? parsed.fields[field].toLowerCase()
          : parsed.fields[field];
        assert.equal(actual, expected, `${testCase.file}: valor incorreto em ${field}`);
      }
      assert.deepEqual(parsed.issues, [], `${testCase.file}: leitura não deve gerar conflito`);
    }
  } finally {
    await worker.terminate();
  }

  console.log("✓ OCR E2E reconheceu armazenamento e bateria após o redimensionamento do app");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

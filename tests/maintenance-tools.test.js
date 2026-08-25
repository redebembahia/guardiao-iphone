"use strict";

const assert = require("node:assert/strict");
const { MAX_FILES, sampledFingerprint, scanFiles } = require("../maintenance-tools.js");

(async () => {
  const first = new Blob(["conteúdo local de teste"]);
  const second = new Blob(["conteúdo local de teste"]);
  const different = new Blob(["outro conteúdo"]);
  const empty = new Blob([]);
  const broken = {
    size: 100,
    slice() {
      return { arrayBuffer: async () => { throw new Error("ilegível"); } };
    }
  };

  const fingerprint = await sampledFingerprint(first);
  assert.equal(fingerprint.length, 64);
  assert.equal(fingerprint, await sampledFingerprint(second));
  assert.notEqual(fingerprint, await sampledFingerprint(different));

  const progress = [];
  const summary = await scanFiles([first, second, different, empty, broken], {
    onProgress: (value) => progress.push(value.current)
  });
  assert.equal(summary.selectedFiles, 5);
  assert.equal(summary.checkedFiles, 5);
  assert.equal(summary.emptyFiles, 1);
  assert.equal(summary.unreadableFiles, 1);
  assert.equal(summary.possibleDuplicateGroups, 1);
  assert.equal(summary.possibleDuplicateFiles, 2);
  assert.deepEqual(progress, [1, 2, 3, 4, 5]);

  const limited = await scanFiles(Array.from({ length: MAX_FILES + 1 }, () => new Blob([])));
  assert.equal(limited.checkedFiles, MAX_FILES);
  assert.equal(limited.truncated, true);

  console.log("✓ verificação segura de arquivos e limites validados");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

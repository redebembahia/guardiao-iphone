(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GuardianMaintenance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SAMPLE_BYTES = 64 * 1024;
  const MAX_FILES = 250;

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function fallbackHash(bytes) {
    let hash = 2166136261;
    for (const value of bytes) {
      hash ^= value;
      hash = Math.imul(hash, 16777619);
    }
    return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  async function sampledFingerprint(file, cryptoApi = globalThis.crypto) {
    if (!file || typeof file.slice !== "function" || !Number.isFinite(file.size)) {
      throw new TypeError("Arquivo inválido.");
    }
    if (file.size === 0) return "empty";

    const first = new Uint8Array(await file.slice(0, Math.min(file.size, SAMPLE_BYTES)).arrayBuffer());
    const lastStart = Math.max(0, file.size - SAMPLE_BYTES);
    const last = lastStart === 0
      ? new Uint8Array(0)
      : new Uint8Array(await file.slice(lastStart, file.size).arrayBuffer());
    const sizeBytes = new TextEncoder().encode(String(file.size));
    const combined = new Uint8Array(sizeBytes.length + 1 + first.length + last.length);
    combined.set(sizeBytes, 0);
    combined[sizeBytes.length] = 0;
    combined.set(first, sizeBytes.length + 1);
    combined.set(last, sizeBytes.length + 1 + first.length);

    if (cryptoApi?.subtle?.digest) {
      const digest = await cryptoApi.subtle.digest("SHA-256", combined);
      return bytesToHex(new Uint8Array(digest));
    }
    return fallbackHash(combined);
  }

  function summarizeChecks(entries, selectedCount, totalBytes) {
    const readable = entries.filter((entry) => entry.readable);
    const fingerprints = new Map();
    readable.forEach((entry) => {
      if (!entry.fingerprint || entry.empty) return;
      const group = fingerprints.get(entry.fingerprint) || [];
      group.push(entry);
      fingerprints.set(entry.fingerprint, group);
    });
    const duplicateGroups = Array.from(fingerprints.values()).filter((group) => group.length > 1);

    return {
      selectedFiles: selectedCount,
      checkedFiles: entries.length,
      totalBytes,
      emptyFiles: entries.filter((entry) => entry.empty).length,
      unreadableFiles: entries.filter((entry) => !entry.readable).length,
      possibleDuplicateGroups: duplicateGroups.length,
      possibleDuplicateFiles: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
      truncated: selectedCount > entries.length
    };
  }

  async function scanFiles(inputFiles, options = {}) {
    const files = Array.from(inputFiles || []);
    const selectedCount = files.length;
    const totalBytes = files.reduce((sum, file) => sum + (Number.isFinite(file?.size) ? file.size : 0), 0);
    const limited = files.slice(0, MAX_FILES);
    const entries = [];

    for (let index = 0; index < limited.length; index += 1) {
      const file = limited[index];
      const entry = { readable: false, empty: file?.size === 0, fingerprint: null };
      try {
        entry.fingerprint = await sampledFingerprint(file, options.cryptoApi);
        entry.readable = true;
      } catch {
        entry.readable = false;
      }
      entries.push(entry);
      options.onProgress?.({ current: index + 1, total: limited.length });
      if (options.signal?.aborted) throw new DOMException("Verificação cancelada.", "AbortError");
    }

    return summarizeChecks(entries, selectedCount, totalBytes);
  }

  return Object.freeze({ MAX_FILES, SAMPLE_BYTES, sampledFingerprint, scanFiles, summarizeChecks });
});

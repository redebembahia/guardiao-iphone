/*
 * Guardiao iPhone - deterministic parsers for OCR text from iOS screenshots.
 *
 * This module intentionally does not perform OCR. It accepts plain OCR text and
 * only extracts values when an iOS screen anchor is present. Every parser is
 * conservative: conflicting values make the result invalid and callers must
 * still ask the user to confirm extracted data.
 */
(function exposeScreenParsers(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.GuardianParsers = api;
    root.GuardiaoScreenParsers = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createScreenParsers() {
  "use strict";

  const STORAGE_ANCHORS = [
    /armazenamento\s+do\s+iphone/,
    /iphone\s+storage/
  ];
  const BATTERY_HEALTH_ANCHORS = [
    /saude\s+da\s+bateria(?:\s+e\s+carregamento)?/,
    /battery\s+health(?:\s+and\s+charging)?/
  ];
  const THERMAL_ANCHORS = [
    /iphone\s+precisa\s+esfriar/,
    /temperatura[^\n]{0,80}iphone/,
    /recarga\s+em\s+espera/,
    /carregamento\s+(?:sera|vai\s+ser)\s+retomado[^\n]{0,100}temperatura/
  ];
  const UPDATE_ANCHORS = [
    /atualizacao\s+de\s+software/,
    /atualizacao\s+do\s+ios/,
    /software\s+update/
  ];
  const BATTERY_USAGE_ANCHORS = [
    /uso\s+da\s+bateria\s+por\s+app/,
    /atividade\s+por\s+app/,
    /battery\s+usage\s+by\s+app/
  ];

  const NON_APP_STORAGE_LABELS = [
    "armazenamento do iphone", "recomendacoes", "recomendacao", "usado", "usados",
    "livre", "livres", "disponivel", "capacidade", "total", "aplicativos", "apps",
    "ios", "dados do sistema", "sistema", "midia", "documentos e dados", "outros"
  ];
  const NON_APP_BATTERY_LABELS = [
    "uso da bateria por app", "atividade por app", "mostrar atividade", "mostrar uso da bateria",
    "nivel da bateria", "atividade", "tela ligada", "tela desligada", "carregamento",
    "ultimas 24 horas", "ultimos 10 dias", "bateria", "total"
  ];

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u00a0\u202f]/g, " ")
      .replace(/[–—−]/g, "-")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean)
      .join("\n");
  }

  function linesOf(normalizedText) {
    return normalizedText ? normalizedText.split("\n").filter(Boolean) : [];
  }

  function hasAnyAnchor(text, anchors) {
    return anchors.some((pattern) => pattern.test(text));
  }

  function numberFromToken(token) {
    if (token == null) return Number.NaN;
    const cleaned = String(token)
      .replace(/[oO]/g, "0")
      .replace(/[lI|]/g, "1")
      .replace(/\s/g, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".")
      .replace(/[^\d.]/g, "");
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : Number.NaN;
  }

  function toGb(numberToken, unitToken) {
    const value = numberFromToken(numberToken);
    if (!Number.isFinite(value)) return Number.NaN;
    const unit = String(unitToken || "gb").toLowerCase();
    if (unit === "tb") return value * 1024;
    if (unit === "mb") return value / 1024;
    if (unit === "kb") return value / (1024 * 1024);
    return value;
  }

  function round(value, digits) {
    const factor = 10 ** (digits == null ? 2 : digits);
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function uniqueNumbers(values, tolerance) {
    const unique = [];
    values.filter(Number.isFinite).forEach((value) => {
      if (!unique.some((current) => Math.abs(current - value) <= tolerance)) unique.push(value);
    });
    return unique.sort((a, b) => a - b);
  }

  function resolveNumber(field, candidates, conflicts, tolerance) {
    const values = uniqueNumbers(candidates.map((candidate) => candidate.value), tolerance);
    if (!values.length) return null;
    if (values.length > 1) {
      conflicts.push({ field, values });
      return null;
    }
    return round(values[0], 2);
  }

  function addCandidate(target, value, source) {
    if (Number.isFinite(value) && value >= 0) target.push({ value, source });
  }

  function baseResult(type, anchored) {
    return {
      type,
      anchored,
      ok: false,
      data: null,
      conflicts: [],
      errors: anchored ? [] : [{ code: "missing_anchor", message: "A tela esperada nao foi identificada." }]
    };
  }

  function finalize(result, requiredFields) {
    if (result.anchored && result.data) {
      requiredFields.forEach((field) => {
        if (result.data[field] == null) {
          result.errors.push({ code: `missing_${field}`, field, message: `Nao foi possivel extrair ${field}.` });
        }
      });
    }
    result.ok = result.anchored && result.conflicts.length === 0 && result.errors.length === 0;
    return result;
  }

  function storageAmountMatches(line) {
    const matches = [];
    const pattern = /([\d.,oOilI|]+)\s*(kb|mb|gb|tb)\b/g;
    let match;
    while ((match = pattern.exec(line))) {
      const value = toGb(match[1], match[2]);
      if (Number.isFinite(value)) matches.push({ value, index: match.index, raw: match[0] });
    }
    return matches;
  }

  function collectStorageNumbers(lines) {
    const total = [];
    const used = [];
    const free = [];

    lines.forEach((line, lineIndex) => {
      const amounts = storageAmountMatches(line);
      if (!amounts.length) return;

      const usedOfTotal = line.match(/([\d.,oOilI|]+)\s*(kb|mb|gb|tb)\s+(?:de|do\s+total\s+de)\s+([\d.,oOilI|]+)\s*(kb|mb|gb|tb)\s+usad/);
      if (usedOfTotal) {
        addCandidate(used, toGb(usedOfTotal[1], usedOfTotal[2]), `line:${lineIndex + 1}:used-of-total`);
        addCandidate(total, toGb(usedOfTotal[3], usedOfTotal[4]), `line:${lineIndex + 1}:used-of-total`);
      }

      const usedThenTotal = line.match(/([\d.,oOilI|]+)\s*(kb|mb|gb|tb)\s+usad[^\n]{0,40}?(?:de|total)\s+([\d.,oOilI|]+)\s*(kb|mb|gb|tb)/);
      if (usedThenTotal) {
        addCandidate(used, toGb(usedThenTotal[1], usedThenTotal[2]), `line:${lineIndex + 1}:used-then-total`);
        addCandidate(total, toGb(usedThenTotal[3], usedThenTotal[4]), `line:${lineIndex + 1}:used-then-total`);
      }

      if (/\b(?:livre|livres|disponivel|disponiveis)\b/.test(line)) {
        amounts.forEach((amount) => addCandidate(free, amount.value, `line:${lineIndex + 1}:free`));
      }
      if (/\busad[oa]s?\b/.test(line) && !usedOfTotal && !usedThenTotal) {
        amounts.forEach((amount) => addCandidate(used, amount.value, `line:${lineIndex + 1}:used`));
      }
      if (/\b(?:capacidade|total)\b/.test(line) && !usedOfTotal && !usedThenTotal) {
        amounts.forEach((amount) => addCandidate(total, amount.value, `line:${lineIndex + 1}:total`));
      }
    });

    return { total, used, free };
  }

  function cleanAppName(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/^[\s•·\-:]+|[\s•·\-:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
  }

  function isExcludedLabel(name, excluded) {
    const normalized = normalizeText(name).replace(/\n/g, " ");
    if (!normalized || normalized.length < 2 || /^\d/.test(normalized)) return true;
    return excluded.some((label) => normalized === label || normalized.startsWith(`${label} `));
  }

  function extractLargestStorageApp(lines) {
    const candidates = [];

    lines.forEach((line, index) => {
      const amounts = storageAmountMatches(line);
      if (amounts.length === 1) {
        const amount = amounts[0];
        const name = cleanAppName(`${line.slice(0, amount.index)} ${line.slice(amount.index + amount.raw.length)}`);
        if (!isExcludedLabel(name, NON_APP_STORAGE_LABELS)) {
          candidates.push({ name, sizeGb: round(amount.value, 2), line: index + 1 });
        }
      }

      if (index + 1 < lines.length && !storageAmountMatches(line).length) {
        const nextAmounts = storageAmountMatches(lines[index + 1]);
        const name = cleanAppName(line);
        if (nextAmounts.length === 1 && !isExcludedLabel(name, NON_APP_STORAGE_LABELS)) {
          candidates.push({ name, sizeGb: round(nextAmounts[0].value, 2), line: index + 1 });
        }
      }
    });

    const deduplicated = [];
    candidates.forEach((candidate) => {
      const existing = deduplicated.find((item) => normalizeText(item.name) === normalizeText(candidate.name));
      if (!existing) deduplicated.push(candidate);
      else if (candidate.sizeGb > existing.sizeGb) Object.assign(existing, candidate);
    });
    deduplicated.sort((a, b) => b.sizeGb - a.sizeGb || a.name.localeCompare(b.name, "pt-BR"));
    return deduplicated[0] || null;
  }

  function parseStorageScreen(input) {
    const text = normalizeText(input && typeof input === "object" ? input.text : input);
    const anchored = hasAnyAnchor(text, STORAGE_ANCHORS);
    const result = baseResult("storage", anchored);
    if (!anchored) return result;

    const lines = linesOf(text);
    const candidates = collectStorageNumbers(lines);
    let totalGb = resolveNumber("totalGb", candidates.total, result.conflicts, 0.2);
    let usedGb = resolveNumber("usedGb", candidates.used, result.conflicts, 0.2);
    let freeGb = resolveNumber("freeGb", candidates.free, result.conflicts, 0.2);

    if (totalGb != null && usedGb != null) {
      const derivedFree = round(totalGb - usedGb, 2);
      if (derivedFree < -0.2) {
        result.conflicts.push({ field: "storageRange", values: [usedGb, totalGb] });
      } else if (freeGb == null) {
        freeGb = Math.max(0, derivedFree);
      } else if (Math.abs(freeGb - derivedFree) > 0.3) {
        result.conflicts.push({ field: "freeGb", values: uniqueNumbers([freeGb, derivedFree], 0.2) });
        freeGb = null;
      }
    } else if (totalGb != null && freeGb != null && usedGb == null) {
      usedGb = round(totalGb - freeGb, 2);
    } else if (usedGb != null && freeGb != null && totalGb == null) {
      totalGb = round(usedGb + freeGb, 2);
    }

    if ((totalGb != null && totalGb <= 0) || (usedGb != null && usedGb < 0) || (freeGb != null && freeGb < 0)) {
      result.conflicts.push({ field: "storageRange", values: [totalGb, usedGb, freeGb].filter((value) => value != null) });
    }

    result.data = {
      totalGb,
      usedGb,
      freeGb,
      largestApp: extractLargestStorageApp(lines)
    };
    return finalize(result, ["totalGb", "usedGb", "freeGb"]);
  }

  function anchoredPercentCandidates(lines, anchorPattern, maxFollowingLines) {
    const candidates = [];
    lines.forEach((line, index) => {
      if (!anchorPattern.test(line)) return;
      const window = [line];
      for (let offset = 1; offset <= maxFollowingLines && index + offset < lines.length; offset += 1) {
        window.push(lines[index + offset]);
      }
      window.forEach((candidateLine, offset) => {
        const matches = candidateLine.matchAll(/([\d.,oOilI|]{1,6})\s*%/g);
        for (const match of matches) {
          const value = numberFromToken(match[1]);
          if (value >= 1 && value <= 100) candidates.push({ value, source: `line:${index + offset + 1}` });
        }
      });
    });
    return candidates;
  }

  function detectBatteryStatuses(text) {
    const statuses = [];
    if (/(?:servico|reparo|manutencao)\s+(?:recomendad[oa]|necessari[oa])|saude[^\n]{0,60}bateria[^\n]{0,60}significativamente\s+degradad[ao]/.test(text)) {
      statuses.push("service");
    }
    if (/nao\s+(?:foi|e)\s+possivel\s+verificar[^\n]{0,100}(?:bateria|peca)[^\n]{0,80}(?:genuina|apple)|peca\s+desconhecida[^\n]{0,80}bateria/.test(text)) {
      statuses.push("unverified_part");
    }
    if (/desempenho\s+reduzido|capacidade\s+de\s+desempenho[^\n]{0,40}reduzid|gerenciamento\s+de\s+desempenho\s+(?:foi\s+)?aplicado/.test(text)) {
      statuses.push("reduced");
    }
    if (/funcionamento\s+normal|desempenho\s+de\s+pico\s+normal|suporta[^\n]{0,80}desempenho\s+(?:de\s+pico\s+)?normal/.test(text)) {
      statuses.push("normal");
    }
    return Array.from(new Set(statuses));
  }

  function parseBatteryHealthScreen(input) {
    const text = normalizeText(input && typeof input === "object" ? input.text : input);
    const anchored = hasAnyAnchor(text, BATTERY_HEALTH_ANCHORS);
    const result = baseResult("batteryHealth", anchored);
    if (!anchored) return result;

    const lines = linesOf(text);
    const capacityCandidates = anchoredPercentCandidates(lines, /capacidade\s+maxima|maximum\s+capacity/, 2);
    const capacityPercent = resolveNumber("capacityPercent", capacityCandidates, result.conflicts, 0);
    const statuses = detectBatteryStatuses(text);
    let status = statuses[0] || "unknown";
    if (statuses.length > 1) {
      result.conflicts.push({ field: "batteryStatus", values: statuses.slice().sort() });
      status = null;
    }

    result.data = { capacityPercent, status };
    return finalize(result, ["capacityPercent"]);
  }

  function parseThermalScreen(input) {
    const text = normalizeText(input && typeof input === "object" ? input.text : input);
    const anchored = hasAnyAnchor(text, THERMAL_ANCHORS);
    const result = baseResult("thermalAlert", anchored);
    if (!anchored) return result;

    const chargingOnHold = /recarga\s+em\s+espera|carregamento\s+(?:sera|vai\s+ser)\s+retomado/.test(text);
    const explicitlyTooHot = /iphone\s+precisa\s+esfriar|iphone\s+(?:esta\s+)?muito\s+quente|temperatura\s+(?:esta\s+)?muito\s+alta/.test(text);
    result.data = {
      thermalState: chargingOnHold && !explicitlyTooHot ? "charging_hold" : "warning",
      kind: chargingOnHold && !explicitlyTooHot ? "charging_on_hold" : "temperature_warning"
    };
    return finalize(result, ["thermalState"]);
  }

  function parseUpdateScreen(input) {
    const text = normalizeText(input && typeof input === "object" ? input.text : input);
    const anchored = hasAnyAnchor(text, UPDATE_ANCHORS);
    const result = baseResult("softwareUpdate", anchored);
    if (!anchored) return result;

    const current = /ios\s+esta\s+atualizado|software\s+(?:esta\s+)?atualizado|seu\s+iphone\s+esta\s+atualizado/.test(text);
    const pending = /baixar\s+e\s+instalar|atualizar\s+agora|instalar\s+agora|atualizacao\s+(?:esta\s+)?disponivel/.test(text);
    let status = "unknown";
    if (current && pending) {
      result.conflicts.push({ field: "updateStatus", values: ["current", "pending"] });
      status = null;
    } else if (pending) status = "pending";
    else if (current) status = "current";

    result.data = { status };
    return finalize(result, []);
  }

  function percentMatches(line) {
    const matches = [];
    const pattern = /([\d.,oOilI|]{1,6})\s*%/g;
    let match;
    while ((match = pattern.exec(line))) {
      const value = numberFromToken(match[1]);
      if (value >= 0 && value <= 100) matches.push({ value, index: match.index, raw: match[0] });
    }
    return matches;
  }

  function extractLargestBatteryConsumer(lines) {
    const anchorIndex = lines.findIndex((line) => hasAnyAnchor(line, BATTERY_USAGE_ANCHORS));
    if (anchorIndex < 0) return null;

    // Deliberately ignore everything before the list anchor. This prevents the
    // status-bar battery percentage from ever being treated as app consumption.
    const listLines = lines.slice(anchorIndex + 1);
    const candidates = [];
    listLines.forEach((line, localIndex) => {
      const percentages = percentMatches(line);
      if (percentages.length === 1) {
        const percentage = percentages[0];
        const name = cleanAppName(`${line.slice(0, percentage.index)} ${line.slice(percentage.index + percentage.raw.length)}`);
        if (!isExcludedLabel(name, NON_APP_BATTERY_LABELS)) {
          candidates.push({ name, percent: round(percentage.value, 1), line: anchorIndex + localIndex + 2 });
        }
      }

      if (localIndex + 1 < listLines.length && !percentMatches(line).length) {
        const nextPercentages = percentMatches(listLines[localIndex + 1]);
        const name = cleanAppName(line);
        if (nextPercentages.length === 1 && !isExcludedLabel(name, NON_APP_BATTERY_LABELS)) {
          candidates.push({ name, percent: round(nextPercentages[0].value, 1), line: anchorIndex + localIndex + 2 });
        }
      }
    });

    const deduplicated = [];
    candidates.forEach((candidate) => {
      const existing = deduplicated.find((item) => normalizeText(item.name) === normalizeText(candidate.name));
      if (!existing) deduplicated.push(candidate);
      else if (candidate.percent > existing.percent) Object.assign(existing, candidate);
    });
    deduplicated.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name, "pt-BR"));
    return deduplicated[0] || null;
  }

  function parseBatteryUsageScreen(input) {
    const text = normalizeText(input && typeof input === "object" ? input.text : input);
    const anchored = hasAnyAnchor(text, BATTERY_USAGE_ANCHORS);
    const result = baseResult("batteryUsage", anchored);
    if (!anchored) return result;
    result.data = { largestConsumer: extractLargestBatteryConsumer(linesOf(text)) };
    return finalize(result, []);
  }

  const PARSERS = [
    parseStorageScreen,
    parseBatteryHealthScreen,
    parseThermalScreen,
    parseUpdateScreen,
    parseBatteryUsageScreen
  ];

  function parseScreen(input) {
    const parsed = PARSERS.map((parser) => parser(input)).filter((result) => result.anchored);
    if (!parsed.length) {
      return {
        type: "unknown",
        anchored: false,
        ok: false,
        data: {},
        conflicts: [],
        errors: [{ code: "missing_anchor", message: "Nenhuma tela iOS compativel foi identificada." }]
      };
    }

    const data = {};
    const conflicts = [];
    const errors = [];
    parsed.forEach((result) => {
      data[result.type] = result.data;
      conflicts.push(...result.conflicts.map((conflict) => ({ ...conflict, screen: result.type })));
      errors.push(...result.errors.map((error) => ({ ...error, screen: result.type })));
    });
    return {
      type: parsed.length === 1 ? parsed[0].type : "mixed",
      anchored: true,
      ok: parsed.every((result) => result.ok),
      data,
      conflicts,
      errors
    };
  }

  const FIELD_DEFAULTS = Object.freeze({
    totalStorage: null,
    freeStorage: null,
    batteryCapacity: null,
    batteryStatus: "unknown",
    thermalState: "unknown",
    updateStatus: "unknown",
    largestApp: null,
    largestAppSize: null,
    topBatteryApp: null,
    topBatteryPercent: null
  });

  const NUMERIC_FIELD_TOLERANCE = Object.freeze({
    totalStorage: 0.2,
    freeStorage: 0.2,
    batteryCapacity: 0,
    largestAppSize: 0.2,
    topBatteryPercent: 0.1
  });

  function screenFields(screen, data) {
    if (!data) return {};
    if (screen === "storage") {
      return {
        totalStorage: data.totalGb,
        freeStorage: data.freeGb,
        largestApp: data.largestApp?.name ?? null,
        largestAppSize: data.largestApp?.sizeGb ?? null
      };
    }
    if (screen === "batteryHealth") {
      return {
        batteryCapacity: data.capacityPercent,
        batteryStatus: data.status || "unknown"
      };
    }
    if (screen === "thermalAlert") return { thermalState: data.thermalState || "unknown" };
    if (screen === "softwareUpdate") return { updateStatus: data.status || "unknown" };
    if (screen === "batteryUsage") {
      return {
        topBatteryApp: data.largestConsumer?.name ?? null,
        topBatteryPercent: data.largestConsumer?.percent ?? null
      };
    }
    return {};
  }

  function meaningfulValue(value) {
    return value != null && value !== "unknown" && value !== "";
  }

  function equivalentFieldValue(field, left, right) {
    if (typeof left === "number" && typeof right === "number") {
      return Math.abs(left - right) <= (NUMERIC_FIELD_TOLERANCE[field] ?? 0);
    }
    return normalizeText(left) === normalizeText(right);
  }

  function parseScreens(inputs) {
    const items = Array.isArray(inputs) ? inputs : inputs == null ? [] : [inputs];
    const results = items.map(parseScreen);
    const fields = { ...FIELD_DEFAULTS };
    const sources = Object.fromEntries(Object.keys(FIELD_DEFAULTS).map((field) => [field, null]));
    const recognizedScreens = [];
    const issues = [];
    const candidates = Object.fromEntries(Object.keys(FIELD_DEFAULTS).map((field) => [field, []]));

    if (!items.length) {
      issues.push({ code: "no_input", severity: "error", message: "Nenhuma captura foi informada." });
    }

    results.forEach((result, inputIndex) => {
      if (!result.anchored) {
        issues.push({
          code: "missing_anchor",
          severity: "error",
          inputIndex,
          message: "A captura nao corresponde a uma tela iOS reconhecida."
        });
        return;
      }

      Object.keys(result.data).forEach((screen) => {
        if (!recognizedScreens.includes(screen)) recognizedScreens.push(screen);
        const mapped = screenFields(screen, result.data[screen]);
        Object.entries(mapped).forEach(([field, value]) => {
          if (meaningfulValue(value)) candidates[field].push({ value, screen, inputIndex });
        });
      });

      result.conflicts.forEach((conflict) => {
        issues.push({
          code: "conflict",
          severity: "error",
          inputIndex,
          screen: conflict.screen,
          field: conflict.field,
          values: conflict.values,
          message: `Valores conflitantes para ${conflict.field}.`
        });
      });
      result.errors.forEach((error) => {
        issues.push({
          code: error.code,
          severity: "error",
          inputIndex,
          screen: error.screen,
          field: error.field,
          message: error.message
        });
      });
    });

    Object.keys(candidates).forEach((field) => {
      const distinct = [];
      candidates[field].forEach((candidate) => {
        if (!distinct.some((existing) => equivalentFieldValue(field, existing.value, candidate.value))) {
          distinct.push(candidate);
        }
      });

      if (distinct.length === 1) {
        fields[field] = distinct[0].value;
        sources[field] = { screen: distinct[0].screen, inputIndex: distinct[0].inputIndex };
      } else if (distinct.length > 1) {
        fields[field] = FIELD_DEFAULTS[field];
        issues.push({
          code: "conflict",
          severity: "error",
          field,
          values: distinct.map((candidate) => candidate.value),
          sources: distinct.map((candidate) => ({ screen: candidate.screen, inputIndex: candidate.inputIndex })),
          message: `Capturas diferentes apresentaram valores conflitantes para ${field}.`
        });
      }
    });

    return { fields, sources, recognizedScreens, issues };
  }

  return Object.freeze({
    normalizeText,
    parseStorageScreen,
    parseBatteryHealthScreen,
    parseThermalScreen,
    parseUpdateScreen,
    parseBatteryUsageScreen,
    parseScreen,
    parseScreens
  });
});

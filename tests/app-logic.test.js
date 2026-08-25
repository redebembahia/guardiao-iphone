"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const context = vm.createContext({
  console,
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; }
  },
  window: {},
  navigator: {},
  crypto: webcrypto,
  Intl,
  Date,
  Blob,
  setTimeout,
  clearTimeout
});

vm.runInContext(fs.readFileSync(require.resolve("../app.js"), "utf8"), context);

function evaluate(source) {
  return vm.runInContext(source, context);
}

assert.equal(
  evaluate("automaticSourceMethod({ totalStorage: 'screenshot', freeStorage: 'screenshot' }, { fastDrain: false, symptoms: [] })"),
  "screenshot"
);
assert.equal(
  evaluate("automaticSourceMethod({ totalStorage: 'screenshot', freeStorage: 'user' }, { fastDrain: false, symptoms: [] })"),
  "screenshot-assisted"
);
assert.equal(
  evaluate("automaticSourceMethod({ totalStorage: 'user', freeStorage: 'user' }, { fastDrain: false, symptoms: [] })"),
  "manual"
);

const healthyUnknown = {
  score: 100,
  input: { thermalState: "unknown", updateStatus: "unknown", batteryStatus: "normal" },
  recommendations: []
};
assert.match(
  evaluate(`resultStatus(${JSON.stringify(healthyUnknown)})`),
  /itens não verificados/i
);

const sampleInput = {
  totalStorage: 256,
  freeStorage: 45.5,
  largestApp: "Fotos",
  largestAppSize: 76,
  batteryCapacity: 75,
  batteryStatus: "reduced",
  fastDrain: false,
  thermalState: "normal",
  symptoms: [],
  updateStatus: "current",
  topBatteryApp: "",
  topBatteryPercent: 0
};
const sampleResult = evaluate(`calculateDiagnosis(${JSON.stringify(sampleInput)})`);
assert.equal(sampleResult.score, 77);
assert.equal(sampleResult.rulesVersion, "1.3.0");
assert.ok(sampleResult.recommendations.some((item) => item.priority === "high"));

for (const override of [
  { thermalState: "warning" },
  { batteryCapacity: 100, batteryStatus: "service" },
  { freeStorage: 4 }
]) {
  const input = { ...sampleInput, batteryCapacity: 100, batteryStatus: "normal", thermalState: "normal", ...override };
  const result = evaluate(`calculateDiagnosis(${JSON.stringify(input)})`);
  assert.equal(evaluate(`scoreColor(${result.score}, worstPriority(${JSON.stringify(result.recommendations)}))`), "#ff6b6b");
}

const chargingHold = evaluate(`calculateDiagnosis(${JSON.stringify({
  ...sampleInput,
  batteryCapacity: 100,
  batteryStatus: "normal",
  thermalState: "charging_hold"
})})`);
assert.equal(chargingHold.score, 90);
assert.match(chargingHold.recommendations[0].body, /muito quente ou muito frio/i);
assert.equal(evaluate(`scoreColor(${chargingHold.score}, worstPriority(${JSON.stringify(chargingHold.recommendations)}))`), "#ffc857");

const unverifiedBattery = evaluate(`calculateDiagnosis(${JSON.stringify({
  ...sampleInput,
  batteryCapacity: 70,
  batteryStatus: "unverified_part"
})})`);
assert.equal(unverifiedBattery.score, 100, "capacidade não verificável não deve ser tratada como desgaste confirmado");
assert.match(unverifiedBattery.recommendations[0].title, /podem não ser precisas/i);

console.log("✓ origem, completude e pontuação do diagnóstico validadas");

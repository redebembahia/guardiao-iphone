"use strict";

const assert = require("node:assert/strict");
const parsers = require("../screen-parsers.js");

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test("rejeita texto com numeros mas sem ancora de tela", () => {
  const result = parsers.parseScreen("10:45 31%\n512 GB\n87%");
  assert.equal(result.ok, false);
  assert.equal(result.type, "unknown");
  assert.equal(result.errors[0].code, "missing_anchor");
});

test("extrai armazenamento, deriva livre e identifica maior app", () => {
  const result = parsers.parseStorageScreen(`
    10:45 31%
    Ajustes
    Armazenamento do iPhone
    455,2 GB de 512 GB usados
    WhatsApp Business 132,4 GB
    Fotos 71,8 GB
    Instagram 4,1 GB
  `);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    totalGb: 512,
    usedGb: 455.2,
    freeGb: 56.8,
    largestApp: { name: "whatsapp business", sizeGb: 132.4, line: 5 }
  });
});

test("aceita valores de armazenamento em linhas separadas", () => {
  const result = parsers.parseStorageScreen(`
    Armazenamento do iPhone
    Capacidade total 512 GB
    Usado 450,4 GB
    Disponível 61,6 GB
    CapCut
    69,63 GB
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.totalGb, 512);
  assert.equal(result.data.usedGb, 450.4);
  assert.equal(result.data.freeGb, 61.6);
  assert.equal(result.data.largestApp.name, "capcut");
  assert.equal(result.data.largestApp.sizeGb, 69.63);
});

test("detecta conflito entre espaco livre informado e derivado", () => {
  const result = parsers.parseStorageScreen(`
    Armazenamento do iPhone
    450 GB de 512 GB usados
    20 GB livres
  `);
  assert.equal(result.ok, false);
  assert.equal(result.data.freeGb, null);
  assert.ok(result.conflicts.some((item) => item.field === "freeGb"));
});

test("detecta dois valores usados conflitantes", () => {
  const result = parsers.parseStorageScreen(`
    Armazenamento do iPhone
    450 GB de 512 GB usados
    Usado 300 GB
  `);
  assert.equal(result.ok, false);
  assert.ok(result.conflicts.some((item) => item.field === "usedGb"));
});

test("saude da bateria ignora primeiro percentual da barra de status", () => {
  const result = parsers.parseBatteryHealthScreen(`
    10:48 Wi-Fi 29%
    Saúde da Bateria e Carregamento
    Capacidade Máxima
    87%
    Capacidade de Desempenho Máximo
    A bateria está oferecendo desempenho de pico normal.
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.capacityPercent, 87);
  assert.equal(result.data.status, "normal");
});

test("aceita percentual na mesma linha da ancora de capacidade", () => {
  const result = parsers.parseBatteryHealthScreen(`
    21%
    Saúde da Bateria
    79% Capacidade Máxima
    Serviço recomendado
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.capacityPercent, 79);
  assert.equal(result.data.status, "service");
});

test("reconhece desempenho reduzido", () => {
  const result = parsers.parseBatteryHealthScreen(`
    Saúde da Bateria e Carregamento
    Capacidade Máxima 83%
    O gerenciamento de desempenho foi aplicado.
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "reduced");
});

test("nao confunde bateria nao verificavel com servico recomendado", () => {
  const result = parsers.parseBatteryHealthScreen(`
    Saúde da Bateria e Carregamento
    Capacidade Máxima 100%
    Mensagem Importante Sobre a Bateria
    Não foi possível verificar se este iPhone possui uma bateria genuína Apple.
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "unverified_part");
});

test("mensagem importante generica nao presume servico", () => {
  const result = parsers.parseBatteryHealthScreen(`
    Saúde da Bateria e Carregamento
    Capacidade Máxima 91%
    Mensagem Importante Sobre a Bateria
  `);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, "unknown");
});

test("detecta capacidades de bateria conflitantes perto da ancora", () => {
  const result = parsers.parseBatteryHealthScreen(`
    Saúde da Bateria
    Capacidade Máxima 87%
    84%
    Funcionamento normal
  `);
  assert.equal(result.ok, false);
  assert.equal(result.data.capacityPercent, null);
  assert.ok(result.conflicts.some((item) => item.field === "capacityPercent"));
});

test("detecta estados de bateria conflitantes", () => {
  const result = parsers.parseBatteryHealthScreen(`
    Saúde da Bateria
    Capacidade Máxima 78%
    Serviço recomendado
    Funcionamento normal
  `);
  assert.equal(result.ok, false);
  assert.equal(result.data.status, null);
  assert.ok(result.conflicts.some((item) => item.field === "batteryStatus"));
});

test("reconhece alerta termico e recarga em espera", () => {
  const warning = parsers.parseThermalScreen("Temperatura: o iPhone precisa esfriar antes de você poder usá-lo.");
  const charging = parsers.parseThermalScreen("Recarga em Espera. O carregamento será retomado quando a temperatura voltar ao normal.");
  assert.equal(warning.ok, true);
  assert.equal(warning.data.kind, "temperature_warning");
  assert.equal(warning.data.thermalState, "warning");
  assert.equal(charging.ok, true);
  assert.equal(charging.data.kind, "charging_on_hold");
  assert.equal(charging.data.thermalState, "charging_hold");
});

test("reconhece iOS atualizado e atualizacao pendente", () => {
  const current = parsers.parseUpdateScreen("Atualização de Software\niOS está atualizado");
  const pending = parsers.parseUpdateScreen("Atualização de Software\niOS 26.1\nBaixar e Instalar");
  assert.equal(current.ok, true);
  assert.equal(current.data.status, "current");
  assert.equal(pending.ok, true);
  assert.equal(pending.data.status, "pending");
});

test("detecta conflito na tela de atualizacao", () => {
  const result = parsers.parseUpdateScreen("Atualização de Software\niOS está atualizado\nAtualizar Agora");
  assert.equal(result.ok, false);
  assert.ok(result.conflicts.some((item) => item.field === "updateStatus"));
});

test("maior consumidor ignora percentual da barra antes da ancora", () => {
  const result = parsers.parseBatteryUsageScreen(`
    11:19 Wi-Fi 20%
    Bateria
    Últimas 24 Horas
    Uso da Bateria por App
    Facebook 15,1%
    Chrome 6,2%
    WhatsApp Business
    6,0%
  `);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.largestConsumer, { name: "facebook", percent: 15.1, line: 5 });
});

test("nao interpreta percentuais sem ancora de lista como consumidor", () => {
  const result = parsers.parseBatteryUsageScreen("Bateria\n20%\nFacebook 15,1%");
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, "missing_anchor");
});

test("parseScreen suporta uma captura com secoes reconhecidas", () => {
  const result = parsers.parseScreen(`
    Saúde da Bateria
    Capacidade Máxima 91%
    Funcionamento normal
  `);
  assert.equal(result.ok, true);
  assert.equal(result.type, "batteryHealth");
  assert.equal(result.data.batteryHealth.capacityPercent, 91);
});

test("parseScreens combina capturas diferentes", () => {
  const result = parsers.parseScreens([
    "Armazenamento do iPhone\n400 GB de 512 GB usados",
    "Saúde da Bateria\nCapacidade Máxima 88%\nFuncionamento normal",
    "Atualização de Software\niOS está atualizado"
  ]);
  assert.deepEqual(result.fields, {
    totalStorage: 512,
    freeStorage: 112,
    batteryCapacity: 88,
    batteryStatus: "normal",
    thermalState: "unknown",
    updateStatus: "current",
    largestApp: null,
    largestAppSize: null,
    topBatteryApp: null,
    topBatteryPercent: null
  });
  assert.deepEqual(result.recognizedScreens, ["storage", "batteryHealth", "softwareUpdate"]);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.sources.batteryCapacity, { screen: "batteryHealth", inputIndex: 1 });
});

test("parseScreens mapeia campos opcionais para o contrato de integracao", () => {
  const result = parsers.parseScreens([
    "Armazenamento do iPhone\n400 GB de 512 GB usados\nWhatsApp Business 80 GB",
    "Uso da Bateria por App\nFacebook 15,1%\nChrome 6,2%",
    "Recarga em Espera. O carregamento será retomado quando a temperatura voltar ao normal."
  ]);
  assert.equal(result.fields.largestApp, "whatsapp business");
  assert.equal(result.fields.largestAppSize, 80);
  assert.equal(result.fields.topBatteryApp, "facebook");
  assert.equal(result.fields.topBatteryPercent, 15.1);
  assert.equal(result.fields.thermalState, "charging_hold");
  assert.deepEqual(result.sources.topBatteryPercent, { screen: "batteryUsage", inputIndex: 1 });
  assert.deepEqual(result.recognizedScreens, ["storage", "batteryUsage", "thermalAlert"]);
  assert.equal(result.issues.length, 0);
});

test("parseScreens detecta duas capturas conflitantes da mesma secao", () => {
  const result = parsers.parseScreens([
    "Saúde da Bateria\nCapacidade Máxima 88%\nFuncionamento normal",
    "Saúde da Bateria\nCapacidade Máxima 82%\nFuncionamento normal"
  ]);
  assert.equal(result.fields.batteryCapacity, null);
  assert.equal(result.fields.batteryStatus, "normal");
  assert.ok(result.issues.some((item) => item.code === "conflict" && item.field === "batteryCapacity"));
});

test("parseScreens retorna contrato estavel quando nao ha entrada", () => {
  const result = parsers.parseScreens([]);
  assert.deepEqual(result.fields, {
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
  assert.deepEqual(result.recognizedScreens, []);
  assert.ok(result.issues.some((item) => item.code === "no_input"));
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    run();
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`✗ ${name}\n${error.stack}\n`);
  }
}

if (failures) {
  process.stderr.write(`\n${failures} de ${tests.length} testes falharam.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${tests.length} testes passaram.\n`);
}

"use strict";

const DB_NAME = "guardiao-iphone";
const DB_VERSION = 1;
const STORE_NAME = "analyses";
const MAX_HISTORY = 30;
const GAUGE_LENGTH = 314.159;
const RULES_VERSION = "1.3.0";
const MAINTENANCE_KEY = "guardiao-maintenance-v1";
const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const thermalLabels = {
  normal: "Normal",
  warm: "Morno",
  hot: "Muito quente",
  warning: "Aviso térmico",
  charging_hold: "Recarga em espera",
  unknown: "Não verificada"
};

const batteryLabels = {
  normal: "Funcionamento normal",
  reduced: "Desempenho reduzido",
  service: "Serviço recomendado",
  unverified_part: "Bateria ou peça não verificada",
  unknown: "Não verificado"
};

const symptomLabels = {
  slow: "abertura lenta de aplicativos",
  reload: "recarregamento frequente de aplicativos",
  keyboard: "atraso no teclado ou nos toques",
  restart: "reinícios ou aplicativos fechando (registro anterior)",
  deviceRestart: "reinícios ou desligamentos inesperados",
  appCrash: "aplicativos fechando sozinhos"
};

const appState = {
  currentStep: 0,
  latest: null,
  history: [],
  deferredInstallPrompt: null,
  automaticSources: {},
  clientEnvironment: null,
  automaticBusy: false,
  automaticAbortController: null
};

const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindNavigation();
  bindAutomaticDiagnosis();
  bindDiagnosis();
  bindDialogs();
  bindTools();
  configureInstallation();
  registerServiceWorker();
  await refreshHistory();
  updateLocalDataSize();
  restoreMaintenanceStatus();
  await maybeRunAutomaticMaintenance();
}

function bindNavigation() {
  all(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  byId("headerAnalyze").addEventListener("click", beginAutomaticDiagnosis);
  byId("startAutomatic").addEventListener("click", beginAutomaticDiagnosis);
  byId("startDiagnosis").addEventListener("click", beginDiagnosis);
  byId("newDiagnosis").addEventListener("click", beginAutomaticDiagnosis);
}

function switchView(viewId) {
  let activeView = null;
  all(".view").forEach((view) => {
    const isActive = view.id === viewId;
    view.hidden = !isActive;
    view.classList.toggle("active", isActive);
    if (isActive) activeView = view;
  });
  all(".nav-item").forEach((item) => {
    const isActive = item.dataset.view === viewId;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  const heading = activeView?.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  if (viewId === "historyView") renderHistory();
  if (viewId === "privacyView") updateLocalDataSize();
}

function beginAutomaticDiagnosis() {
  byId("screenshotPicker").value = "";
  byId("automaticReviewForm").reset();
  byId("automaticReviewForm").hidden = true;
  byId("automaticProgress").hidden = true;
  byId("automaticReviewError").textContent = "";
  appState.automaticSources = {};
  appState.clientEnvironment = detectClientEnvironment();
  renderClientEnvironment(appState.clientEnvironment);
  switchView("automaticView");
  all(".nav-item").forEach((item) => {
    item.classList.remove("active");
    item.removeAttribute("aria-current");
  });
}

function bindAutomaticDiagnosis() {
  byId("cancelAutomatic").addEventListener("click", () => {
    if (appState.automaticBusy) {
      appState.automaticAbortController?.abort();
      showToast("Cancelando a leitura…");
      return;
    }
    switchView("homeView");
  });
  byId("automaticManualFallback").addEventListener("click", beginDiagnosis);
  byId("screenshotPicker").addEventListener("change", handleScreenshotSelection);
  byId("rescanScreenshots").addEventListener("click", () => {
    if (appState.automaticBusy) return;
    byId("screenshotPicker").click();
  });
  byId("automaticReviewForm").addEventListener("submit", finishAutomaticDiagnosis);

  [
    ["autoTotalStorage", "totalStorage", "autoTotalStorageSource"],
    ["autoFreeStorage", "freeStorage", "autoFreeStorageSource"],
    ["autoBatteryCapacity", "batteryCapacity", "autoBatteryCapacitySource"],
    ["autoBatteryStatus", "batteryStatus", "autoBatteryStatusSource"],
    ["autoThermalState", "thermalState", "autoThermalStateSource"],
    ["autoUpdateStatus", "updateStatus", "autoUpdateStatusSource"],
    ["autoLargestApp", "largestApp"],
    ["autoLargestAppSize", "largestAppSize"],
    ["autoTopBatteryApp", "topBatteryApp"],
    ["autoTopBatteryPercent", "topBatteryPercent"]
  ].forEach(([inputId, sourceKey, badgeId]) => {
    byId(inputId).addEventListener("input", () => markAutomaticFieldEdited(inputId, sourceKey, badgeId));
  });
}

async function handleScreenshotSelection(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length || appState.automaticBusy) return;
  const scanner = window.GuardianScreenshotImport;
  if (!scanner?.scan) {
    showToast("O leitor local ainda não está disponível. Reabra o aplicativo com internet e tente novamente.");
    return;
  }

  setAutomaticBusy(true);
  const controller = new AbortController();
  appState.automaticAbortController = controller;
  byId("automaticReviewForm").hidden = true;
  byId("automaticReviewError").textContent = "";
  updateAutomaticProgress({
    percent: 1,
    title: "Preparando o leitor local…",
    detail: "Nenhuma captura será enviada para a internet."
  });

  try {
    const parsed = await scanner.scan(files, {
      onProgress: updateAutomaticProgress,
      signal: controller.signal
    });
    populateAutomaticReview(parsed || {});
    updateAutomaticProgress({
      percent: 100,
      title: "Leitura concluída",
      detail: "As imagens e o texto bruto já foram descartados."
    });
    byId("automaticReviewForm").hidden = false;
    byId("automaticReviewForm").scrollIntoView({ behavior: "smooth", block: "start" });
    const foundCount = Object.values(parsed?.fields || {}).filter((value) => value !== null && value !== undefined && value !== "" && value !== "unknown").length;
    showToast(foundCount ? "Dados extraídos. Confira e confirme." : "Não consegui identificar essas telas. Confira os campos ou use o modo manual.");
  } catch (error) {
    byId("automaticProgress").hidden = true;
    if (error?.name === "AbortError") {
      switchView("homeView");
      showToast("Leitura cancelada. Nenhuma captura foi armazenada.");
      return;
    }
    const message = error?.message || "Não foi possível ler as capturas.";
    showToast(message);
  } finally {
    if (appState.automaticAbortController === controller) appState.automaticAbortController = null;
    event.target.value = "";
    setAutomaticBusy(false);
  }
}

function updateAutomaticProgress(update = {}) {
  const percent = Math.max(0, Math.min(100, Number(update.percent) || 0));
  const container = byId("automaticProgress");
  container.hidden = false;
  byId("automaticProgressBar").value = percent;
  if (update.title) byId("automaticProgressTitle").textContent = update.title;
  if (update.detail) byId("automaticProgressDetail").textContent = update.detail;
}

function setAutomaticBusy(busy) {
  appState.automaticBusy = busy;
  byId("screenshotPicker").disabled = busy;
  const label = document.querySelector('label[for="screenshotPicker"]');
  if (label) label.setAttribute("aria-disabled", String(busy));
  byId("automaticManualFallback").disabled = busy;
  byId("rescanScreenshots").disabled = busy;
  byId("cancelAutomatic").setAttribute("aria-label", busy ? "Cancelar leitura" : "Voltar ao início");
  all(".nav-item").forEach((item) => { item.disabled = busy; });
}

function populateAutomaticReview(parsed) {
  const fields = parsed.fields || {};
  appState.automaticSources = {};

  setAutomaticField("TotalStorage", fields.totalStorage);
  setAutomaticField("FreeStorage", fields.freeStorage);
  setAutomaticField("BatteryCapacity", fields.batteryCapacity);
  setAutomaticField("BatteryStatus", fields.batteryStatus);

  byId("autoThermalState").value = fields.thermalState || "unknown";
  byId("autoUpdateStatus").value = fields.updateStatus || "unknown";
  byId("autoLargestApp").value = formatRecognizedName(fields.largestApp);
  byId("autoLargestAppSize").value = formatInputNumber(fields.largestAppSize);
  byId("autoTopBatteryApp").value = formatRecognizedName(fields.topBatteryApp);
  byId("autoTopBatteryPercent").value = formatInputNumber(fields.topBatteryPercent);

  appState.automaticSources.thermalState = fields.thermalState && fields.thermalState !== "unknown" ? "screenshot" : "unverified";
  appState.automaticSources.updateStatus = fields.updateStatus && fields.updateStatus !== "unknown" ? "screenshot" : "unverified";
  renderAutomaticSourceBadge("autoThermalStateSource", appState.automaticSources.thermalState);
  renderAutomaticSourceBadge("autoUpdateStatusSource", appState.automaticSources.updateStatus);
  byId("autoSignalsDetails").open = appState.automaticSources.thermalState === "screenshot"
    || appState.automaticSources.updateStatus === "screenshot";
  appState.automaticSources.largestApp = fields.largestApp ? "screenshot" : "unverified";
  appState.automaticSources.largestAppSize = fields.largestAppSize !== null && fields.largestAppSize !== undefined ? "screenshot" : "unverified";
  appState.automaticSources.topBatteryApp = fields.topBatteryApp ? "screenshot" : "unverified";
  appState.automaticSources.topBatteryPercent = fields.topBatteryPercent !== null && fields.topBatteryPercent !== undefined ? "screenshot" : "unverified";

  const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const missing = ["autoTotalStorage", "autoFreeStorage", "autoBatteryCapacity"].filter((id) => byId(id).value === "");
  const messages = [];
  if (missing.length) messages.push("Complete os campos em amarelo que não puderam ser lidos.");
  if (issues.length) messages.push(issues.slice(0, 2).map((issue) => issue?.message || "Uma captura precisa ser conferida.").join(" "));
  byId("automaticReviewError").textContent = messages.join(" ");
}

function setAutomaticField(suffix, capturedValue) {
  const input = byId(`auto${suffix}`);
  const sourceNode = byId(`auto${suffix}Source`);
  const hasCaptured = capturedValue !== null && capturedValue !== undefined && capturedValue !== "" && capturedValue !== "unknown";
  const value = hasCaptured ? capturedValue : "";
  input.value = suffix === "BatteryStatus" ? (value || "unknown") : formatInputNumber(value);

  const source = hasCaptured ? "screenshot" : "unverified";
  appState.automaticSources[`${suffix.charAt(0).toLowerCase()}${suffix.slice(1)}`] = source;

  if (source === "screenshot") {
    sourceNode.textContent = "LIDO — CONFIRA";
    sourceNode.className = "source-badge";
  } else {
    sourceNode.textContent = suffix === "BatteryStatus" ? "CONFIRME" : "NÃO ENCONTRADO";
    sourceNode.className = "source-badge pending";
  }
}

function markAutomaticFieldEdited(inputId, sourceKey, badgeId) {
  const value = byId(inputId).value;
  const isEmpty = value === "" || value === "unknown";
  appState.automaticSources[sourceKey] = isEmpty ? "unverified" : "user";
  if (!badgeId) return;
  const badge = byId(badgeId);
  const needsVerification = sourceKey === "batteryStatus" || sourceKey === "thermalState" || sourceKey === "updateStatus";
  badge.textContent = isEmpty ? (needsVerification ? "NÃO VERIFICADA" : "NÃO ENCONTRADO") : "AJUSTADO POR VOCÊ";
  badge.className = isEmpty ? "source-badge pending" : "source-badge user";
}

function renderAutomaticSourceBadge(badgeId, source) {
  const badge = byId(badgeId);
  if (source === "screenshot") {
    badge.textContent = "LIDO — CONFIRA";
    badge.className = "source-badge";
    return;
  }
  badge.textContent = "NÃO VERIFICADA";
  badge.className = "source-badge pending";
}

function formatInputNumber(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) return "";
  return String(value);
}

function formatRecognizedName(value) {
  const name = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (!name) return "";
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const known = {
    "fotos": "Fotos",
    "photos": "Fotos",
    "whatsapp": "WhatsApp",
    "whatsapp business": "WhatsApp Business",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "instagram lite": "Instagram Lite",
    "chrome": "Chrome",
    "safari": "Safari",
    "telegram": "Telegram",
    "youtube": "YouTube",
    "google drive": "Google Drive",
    "capcut": "CapCut",
    "tiktok": "TikTok"
  };
  if (known[normalized]) return known[normalized];
  return name.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase()).slice(0, 40);
}

async function finishAutomaticDiagnosis(event) {
  event.preventDefault();
  byId("automaticReviewError").textContent = "";
  all('#automaticReviewForm [aria-invalid="true"]').forEach((node) => node.removeAttribute("aria-invalid"));
  const totalStorage = automaticNumericValue("autoTotalStorage");
  const freeStorage = automaticNumericValue("autoFreeStorage");
  const batteryCapacity = automaticNumericValue("autoBatteryCapacity");
  const batteryStatus = byId("autoBatteryStatus").value || "unknown";
  const largestApp = byId("autoLargestApp").value.trim().slice(0, 40);
  const largestAppSize = optionalNumericValue("autoLargestAppSize");
  const topBatteryApp = byId("autoTopBatteryApp").value.trim().slice(0, 40);
  const topBatteryPercent = optionalNumericValue("autoTopBatteryPercent");

  if (![128, 256, 512, 1024].includes(totalStorage) || Number.isNaN(freeStorage) || freeStorage < 0 || freeStorage > totalStorage) {
    setAutomaticError("Confirme a capacidade total e um espaço disponível válido.", "autoFreeStorage");
    return;
  }
  if (Number.isNaN(batteryCapacity) || batteryCapacity < 1 || batteryCapacity > 100) {
    setAutomaticError("Confirme a capacidade máxima da bateria entre 1% e 100%.", "autoBatteryCapacity");
    return;
  }
  const usedStorage = totalStorage - freeStorage;
  if (!Number.isFinite(largestAppSize) || largestAppSize < 0 || largestAppSize > usedStorage + 0.1 || (largestAppSize > 0 && !largestApp)) {
    setAutomaticError("Confira o maior item: informe o nome e um tamanho entre 0 e o espaço usado.", "autoLargestAppSize");
    return;
  }
  if (!Number.isFinite(topBatteryPercent) || topBatteryPercent < 0 || topBatteryPercent > 100 || (topBatteryPercent > 0 && !topBatteryApp)) {
    setAutomaticError("Confira o uso de bateria: informe o aplicativo e um percentual entre 0% e 100%.", "autoTopBatteryPercent");
    return;
  }

  const input = {
    totalStorage,
    freeStorage,
    largestApp,
    largestAppSize,
    batteryCapacity,
    batteryStatus,
    fastDrain: byId("autoFastDrain").checked,
    thermalState: byId("autoThermalState").value || "unknown",
    symptoms: all('input[name="autoSymptom"]:checked').map((item) => item.value),
    updateStatus: byId("autoUpdateStatus").value || "unknown",
    topBatteryApp,
    topBatteryPercent
  };
  const result = calculateDiagnosis(input);
  result.sources = { ...appState.automaticSources };
  result.sourceMethod = automaticSourceMethod(result.sources, input);
  result.confidence = result.sourceMethod === "screenshot"
    ? "screenshot-confirmed"
    : result.sourceMethod === "screenshot-assisted" ? "screenshot-assisted" : "user-confirmed";
  const successMessage = result.sourceMethod === "screenshot"
    ? "Capturas confirmadas e análise salva somente neste aparelho."
    : result.sourceMethod === "screenshot-assisted"
      ? "Capturas conferidas e análise salva somente neste aparelho."
      : "Análise salva com os dados preenchidos neste aparelho.";
  await persistCompletedDiagnosis(result, successMessage);
}

function setAutomaticError(message, focusId) {
  byId("automaticReviewError").textContent = message;
  const target = byId(focusId);
  target?.setAttribute("aria-invalid", "true");
  target?.focus();
  showToast(message);
}

function automaticSourceMethod(sources, input) {
  const values = Object.values(sources || {});
  const hasScreenshot = values.includes("screenshot");
  const hasUserEntry = values.includes("user") || input.fastDrain || input.symptoms.length > 0;
  if (hasScreenshot && hasUserEntry) return "screenshot-assisted";
  if (hasScreenshot) return "screenshot";
  return "manual";
}

function automaticNumericValue(id) {
  const raw = byId(id).value;
  if (raw === "") return Number.NaN;
  return Number(String(raw).replace(",", "."));
}

function optionalNumericValue(id) {
  const raw = byId(id).value;
  if (raw === "") return 0;
  return Number(String(raw).replace(",", "."));
}

function detectClientEnvironment() {
  const userAgent = navigator.userAgent || "";
  const iosMatch = userAgent.match(/(?:CPU iPhone OS|iPhone OS)\s(\d+)(?:[._](\d+))?/i);
  const isIPhone = /iPhone/i.test(userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return {
    device: "iPhone 14 Pro Max (configurado)",
    system: iosMatch ? `iOS ${iosMatch[1]}${iosMatch[2] ? `.${iosMatch[2]}` : ""}` : isIPhone ? "iOS" : "Não identificado",
    mode: standalone ? "App instalado" : "Safari",
    detectedAt: Date.now()
  };
}

function renderClientEnvironment(environment) {
  byId("detectedDevice").textContent = environment.device;
  byId("detectedSystem").textContent = environment.system;
  byId("detectedMode").textContent = environment.mode;
}

function beginDiagnosis() {
  byId("diagnosisForm").reset();
  appState.currentStep = 0;
  clearValidationMessages();
  switchView("diagnosisView");
  renderWizardStep();
  all(".nav-item").forEach((item) => {
    item.classList.remove("active");
    item.removeAttribute("aria-current");
  });
}

function bindDiagnosis() {
  byId("cancelDiagnosis").addEventListener("click", () => switchView("homeView"));
  byId("previousStep").addEventListener("click", () => {
    if (appState.currentStep > 0) {
      appState.currentStep -= 1;
      renderWizardStep();
    }
  });
  byId("nextStep").addEventListener("click", () => {
    if (!validateStep(appState.currentStep)) return;
    if (appState.currentStep < 3) {
      appState.currentStep += 1;
      renderWizardStep();
    }
  });
  byId("diagnosisForm").addEventListener("submit", finishDiagnosis);
}

function renderWizardStep() {
  all(".wizard-step").forEach((step, index) => {
    const active = index === appState.currentStep;
    step.hidden = !active;
    step.classList.toggle("active", active);
  });
  byId("stepCounter").textContent = `Etapa ${appState.currentStep + 1} de 4`;
  byId("stepProgressBar").className = `step-${appState.currentStep + 1}`;
  byId("previousStep").hidden = appState.currentStep === 0;
  byId("nextStep").hidden = appState.currentStep === 3;
  byId("finishDiagnosis").hidden = appState.currentStep !== 3;
  const activeLegend = document.querySelector(`.wizard-step[data-step="${appState.currentStep}"] legend`);
  if (activeLegend) activeLegend.focus?.();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validateStep(step) {
  clearValidationMessages();
  if (step === 0) {
    const total = numericValue("totalStorage");
    const free = numericValue("freeStorage");
    if (!total || Number.isNaN(free) || free < 0 || free > total) {
      setError("storage", "Selecione a capacidade e informe um espaço disponível válido, menor que o total.", "freeStorage");
      return false;
    }
    const largestApp = byId("largestApp").value.trim();
    const largestAppSize = optionalNumericValue("largestAppSize");
    const usedStorage = total - free;
    if (!Number.isFinite(largestAppSize) || largestAppSize < 0 || largestAppSize > usedStorage + 0.1 || (largestAppSize > 0 && !largestApp)) {
      setError("storage", "No maior item opcional, informe o nome e um tamanho entre 0 e o espaço usado.", "largestAppSize");
      return false;
    }
  }
  if (step === 1) {
    const capacity = numericValue("batteryCapacity");
    const status = byId("batteryStatus").value;
    if (!capacity || capacity < 1 || capacity > 100 || !status) {
      setError("battery", "Informe a capacidade máxima entre 1% e 100% e selecione a mensagem do iOS.", "batteryCapacity");
      return false;
    }
  }
  if (step === 2 && !document.querySelector('input[name="thermalState"]:checked')) {
    setError("thermal", "Selecione como está a temperatura do aparelho.");
    return false;
  }
  if (step === 3 && !byId("updateStatus").value) {
    setError("performance", "Informe se existe uma atualização do iOS pendente.", "updateStatus");
    return false;
  }
  return true;
}

function setError(key, message, focusId) {
  const target = document.querySelector(`[data-error-for="${key}"]`);
  if (target) target.textContent = message;
  const field = focusId ? byId(focusId) : key === "thermal" ? document.querySelector('input[name="thermalState"]') : null;
  field?.setAttribute("aria-invalid", "true");
  field?.focus();
  showToast(message);
}

function clearValidationMessages() {
  all(".field-error").forEach((node) => { node.textContent = ""; });
  all("select.invalid").forEach((node) => node.classList.remove("invalid"));
  all('[aria-invalid="true"]').forEach((node) => node.removeAttribute("aria-invalid"));
}

async function finishDiagnosis(event) {
  event.preventDefault();
  for (let step = 0; step < 4; step += 1) {
    if (validateStep(step)) continue;
    appState.currentStep = step;
    renderWizardStep();
    return;
  }
  const input = collectFormData();
  const result = calculateDiagnosis(input);
  result.sourceMethod = "manual";
  await persistCompletedDiagnosis(result, "Diagnóstico concluído e salvo somente neste aparelho.");
}

async function persistCompletedDiagnosis(result, successMessage) {
  try {
    await saveAnalysis(result);
  } catch {
    appState.latest = result;
    renderLatest(result);
    switchView("homeView");
    showToast("Diagnóstico concluído, mas o histórico local não pôde ser salvo.");
    return;
  }
  appState.latest = result;
  await refreshHistory(false);
  renderLatest(result);
  switchView("homeView");
  showToast(successMessage);
}

function collectFormData() {
  return {
    totalStorage: numericValue("totalStorage"),
    freeStorage: numericValue("freeStorage"),
    largestApp: byId("largestApp").value.trim().slice(0, 40),
    largestAppSize: optionalNumericValue("largestAppSize"),
    batteryCapacity: numericValue("batteryCapacity"),
    batteryStatus: byId("batteryStatus").value,
    fastDrain: byId("fastDrain").checked,
    thermalState: document.querySelector('input[name="thermalState"]:checked')?.value || "normal",
    symptoms: checkedValues("symptom"),
    updateStatus: byId("updateStatus").value
  };
}

function numericValue(id) {
  const raw = byId(id).value;
  if (raw === "") return Number.NaN;
  return Number(raw.replace?.(",", ".") ?? raw);
}

function checkedValues(name) {
  return all(`input[name="${name}"]:checked`).map((item) => item.value);
}

function calculateDiagnosis(input) {
  let score = 100;
  const recommendations = [];
  const freeRatio = input.freeStorage / input.totalStorage;
  const targetFree = Math.ceil(Math.max(0, input.totalStorage * 0.15 - input.freeStorage));

  if (input.thermalState === "warning") {
    score -= 25;
    recommendations.push({
      priority: "critical",
      title: "Interrompa o uso e deixe o iPhone esfriar",
      body: "Desconecte o carregador, retire a capa e leve o aparelho para um local ventilado. Não use gelo, geladeira ou água."
    });
  } else if (input.thermalState === "charging_hold") {
    score -= 10;
    recommendations.push({
      priority: "high",
      title: "Aguarde a temperatura voltar à faixa normal",
      body: "Recarga em Espera pode aparecer quando o iPhone está muito quente ou muito frio. Desconecte o carregador e leve-o a um ambiente de temperatura moderada. Se estiver quente, retire a capa e ventile; se estiver frio, deixe aquecer naturalmente. Não use gelo, geladeira, secador ou aquecedor."
    });
  } else if (input.thermalState === "hot") {
    score -= 15;
    recommendations.push({
      priority: "high",
      title: "Investigue o aquecimento frequente",
      body: "Suspenda câmera, jogos, backup e carregamento até a temperatura normalizar. Verifique se um aplicativo está mantendo atividade elevada."
    });
  } else if (input.thermalState === "warm") {
    score -= 4;
    recommendations.push({
      priority: "normal",
      title: "Acompanhe a temperatura",
      body: "Aquecimento leve durante câmera, carregamento ou backup pode ocorrer. Confirme se o aparelho esfria após alguns minutos em repouso."
    });
  } else if (input.thermalState === "unknown") {
    recommendations.push({
      priority: "normal",
      title: "Temperatura não verificada automaticamente",
      body: "O Safari não recebe o estado térmico interno do iPhone. Se houver calor frequente, complete esse sinal na próxima análise e interrompa o uso se aparecer um aviso de temperatura."
    });
  }

  if (input.freeStorage < 5 || freeRatio < 0.05) {
    score -= 35;
    recommendations.push({
      priority: "critical",
      title: "Armazenamento em nível crítico",
      body: `Restam ${formatGb(input.freeStorage)}. Procure liberar aproximadamente ${formatGb(Math.max(targetFree, 5))}; 15% é a margem preventiva adotada pelo Guardião, não uma exigência oficial do iOS.`
    });
  } else if (input.freeStorage < 15 || freeRatio < 0.10) {
    score -= 20;
    recommendations.push({
      priority: "high",
      title: "Aumente a margem preventiva de armazenamento",
      body: `Restam ${formatGb(input.freeStorage)}. Revise aplicativos, downloads e vídeos até alcançar a margem preventiva do Guardião, cerca de ${formatGb(input.totalStorage * 0.15)} livres.`
    });
  } else if (freeRatio < 0.15) {
    score -= 12;
    recommendations.push({
      priority: "high",
      title: "Armazenamento abaixo da margem preventiva do Guardião",
      body: `Libere aproximadamente ${formatGb(Math.max(targetFree, 1))} para chegar à margem preventiva de 15% adotada por este aplicativo.`
    });
  }

  let capacityPenalty = 0;
  if (input.batteryStatus !== "unverified_part") {
    if (input.batteryCapacity < 80) capacityPenalty = 18;
    else if (input.batteryCapacity < 85) capacityPenalty = 12;
    else if (input.batteryCapacity < 90) capacityPenalty = 6;
  }

  const statusPenalty = input.batteryStatus === "service" ? 25 : input.batteryStatus === "reduced" ? 15 : 0;
  let batteryPenalty = Math.max(capacityPenalty, statusPenalty);
  if (input.batteryStatus === "reduced" && input.batteryCapacity < 80) {
    batteryPenalty = Math.min(25, batteryPenalty + 5);
  }
  score -= batteryPenalty;

  if (input.batteryStatus === "service") {
    recommendations.push({
      priority: "critical",
      title: "O iOS recomenda serviço na bateria",
      body: "Faça backup e procure a Apple ou uma assistência autorizada. A mensagem do sistema é mais importante que qualquer estimativa deste aplicativo."
    });
  } else if (input.batteryStatus === "unverified_part") {
    recommendations.push({
      priority: "normal",
      title: "As informações da bateria podem não ser precisas",
      body: "O iOS não conseguiu verificar a bateria ou a peça. Não trate a capacidade exibida como diagnóstico de desgaste. Consulte Ajustes › Geral › Sobre › Histórico de Peças e Serviço e procure avaliação se a mensagem for inesperada ou houver falhas."
    });
  } else if (input.batteryStatus === "reduced") {
    recommendations.push({
      priority: "high",
      title: "A bateria está limitando o desempenho",
      body: `Com ${input.batteryCapacity}% de capacidade e o aviso de desempenho reduzido, a bateria é uma causa provável de lentidão, descarga rápida ou desligamentos. Faça backup e agende uma avaliação; a substituição pode restaurar autonomia e desempenho.`
    });
  } else if (input.batteryCapacity < 80) {
    recommendations.push({
      priority: "high",
      title: "Capacidade máxima abaixo de 80%",
      body: "A bateria está abaixo da referência de retenção prevista para este modelo. Confirme a mensagem do próprio iOS e programe uma avaliação se houver pouca autonomia, lentidão ou desligamentos."
    });
  } else if (input.batteryCapacity < 85) {
    recommendations.push({
      priority: "high",
      title: "Bateria com desgaste relevante",
      body: "Compare a autonomia nos próximos dias e verifique os aplicativos com maior atividade em Ajustes › Bateria."
    });
  } else if (input.batteryCapacity < 90) {
    recommendations.push({
      priority: "normal",
      title: "Acompanhe a evolução da bateria",
      body: "A capacidade mostra desgaste moderado. Evite calor durante o carregamento e observe mudanças rápidas de autonomia."
    });
  }

  if (input.fastDrain) {
    score -= 10;
    recommendations.push({
      priority: "high",
      title: "Compare o consumo das últimas 24 horas e 10 dias",
      body: "Em Ajustes › Bateria, toque em Mostrar Atividade e procure aplicativos com muita atividade em segundo plano e pouco tempo de tela."
    });
  }

  if (input.topBatteryApp && input.topBatteryPercent > 0) {
    recommendations.push({
      priority: "normal",
      title: `Confira a atividade de ${input.topBatteryApp}`,
      body: `${input.topBatteryApp} apareceu com ${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(input.topBatteryPercent)}% do uso mostrado. Em Ajustes › Bateria, toque em Mostrar Atividade para separar uso em tela de atividade em segundo plano antes de restringir o aplicativo.`
    });
  }

  let symptomPenalty = 0;
  if (input.symptoms.includes("slow")) symptomPenalty += 4;
  if (input.symptoms.includes("reload")) symptomPenalty += 3;
  if (input.symptoms.includes("keyboard")) symptomPenalty += 3;
  if (input.symptoms.includes("restart")) symptomPenalty += 9;
  if (input.symptoms.includes("deviceRestart")) symptomPenalty += 9;
  if (input.symptoms.includes("appCrash")) symptomPenalty += 4;
  score -= Math.min(symptomPenalty, 15);

  const hasUnexpectedRestart = input.symptoms.includes("restart") || input.symptoms.includes("deviceRestart");
  if (hasUnexpectedRestart) {
    recommendations.push({
      priority: "high",
      title: "Priorize os reinícios ou desligamentos inesperados",
      body: input.batteryStatus === "reduced" || input.batteryStatus === "service"
        ? "A bateria degradada pode estar relacionada. Faça backup e procure avaliação da bateria; se o problema continuar após o serviço, solicite um diagnóstico completo do aparelho."
        : "Faça backup, atualize o iOS e observe se o problema se repete. Se continuar, procure diagnóstico técnico do aparelho."
    });
  }

  const otherSymptoms = input.symptoms.filter((item) => item !== "restart" && item !== "deviceRestart");
  if (otherSymptoms.length) {
    const description = otherSymptoms.map((item) => symptomLabels[item]).filter(Boolean).join(", ");
    recommendations.push({
      priority: "normal",
      title: "Corrija os demais sintomas de desempenho",
      body: `Você informou ${description}. Reinicie o iPhone e atualize o iOS e os aplicativos antes de medidas mais invasivas.`
    });
  }

  if (input.updateStatus === "pending") {
    score -= 5;
    recommendations.push({
      priority: "normal",
      title: "Instale a atualização pendente com segurança",
      body: "Faça backup, conecte ao Wi‑Fi e ao carregador e atualize em Ajustes › Geral › Atualização de Software."
    });
  } else if (input.updateStatus === "unknown") {
    recommendations.push({
      priority: "normal",
      title: "Verifique a versão do iOS",
      body: "Abra Ajustes › Geral › Atualização de Software e confirme se há correção disponível."
    });
  }

  if (input.largestApp && input.largestAppSize >= 8) {
    const normalizedLargest = input.largestApp.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/(^|\s)(fotos|photos)(\s|$)/.test(normalizedLargest)) {
      recommendations.push({
        priority: "normal",
        title: freeRatio >= 0.15 ? "Fotos ocupa muito espaço, mas não há urgência" : "Revise fotos e vídeos com segurança",
        body: `A biblioteca ocupa ${formatGb(input.largestAppSize)} e restam ${formatGb(input.freeStorage)} livres. Antes de apagar, exporte uma cópia independente e confirme que ela abre. O Fotos do iCloud sincroniza exclusões; para ganhar espaço sem excluir, use Otimizar Armazenamento do iPhone.`
      });
    } else if (normalizedLargest.includes("whatsapp")) {
      recommendations.push({
        priority: "normal",
        title: "Revise os maiores arquivos do WhatsApp",
        body: `O item ocupa ${formatGb(input.largestAppSize)}. Abra WhatsApp › Configurações › Armazenamento e dados › Gerenciar armazenamento e confirme o backup antes de excluir conteúdo importante.`
      });
    } else {
      recommendations.push({
        priority: "normal",
        title: `Revise os dados de ${input.largestApp}`,
        body: `O item ocupa ${formatGb(input.largestAppSize)}. Abra seus controles de armazenamento e remova somente conteúdo dispensável após confirmar o backup.`
      });
    }
  }

  if (!recommendations.length) {
    recommendations.push({
      priority: "normal",
      title: "Nenhum alerta importante informado",
      body: "Continue acompanhando espaço livre, capacidade máxima da bateria, temperatura e consumo por aplicativo."
    });
  }

  recommendations.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
  score = Math.max(0, Math.min(100, score));

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: Date.now(),
    model: "iPhone 14 Pro Max",
    score,
    rulesVersion: RULES_VERSION,
    confidence: "form-complete",
    input,
    recommendations
  };
}

function priorityRank(priority) {
  return priority === "critical" ? 0 : priority === "high" ? 1 : 2;
}

function renderLatest(result) {
  if (!result) {
    renderEmptyState();
    return;
  }
  const used = Math.max(0, result.input.totalStorage - result.input.freeStorage);
  const usedPercent = Math.round((used / result.input.totalStorage) * 100);
  byId("lastAnalysis").textContent = `Atualizada em ${formatDate(result.createdAt)}`;
  byId("confidenceBadge").textContent = result.sourceMethod === "screenshot"
    ? "CAPTURAS CONFIRMADAS"
    : result.sourceMethod === "screenshot-assisted" ? "CAPTURA + CONFERÊNCIA" : "DADOS PREENCHIDOS";
  byId("confidenceBadge").className = "confidence-badge complete";
  byId("scoreNumber").textContent = String(result.score);
  byId("scoreStatus").textContent = resultStatus(result);
  renderGauge(result.score, false, worstPriority(result.recommendations));
  byId("storageMetric").textContent = `${usedPercent}%`;
  byId("storageDetail").textContent = `${formatGb(result.input.freeStorage)} livres`;
  byId("batteryMetric").textContent = `${result.input.batteryCapacity}%`;
  byId("batteryDetail").textContent = batteryLabels[result.input.batteryStatus] || "Informado pelo usuário";
  byId("thermalMetric").textContent = thermalLabels[result.input.thermalState] || "—";
  byId("thermalDetail").textContent = result.input.thermalState === "unknown"
    ? "Não disponível no Safari"
    : result.sources?.thermalState === "screenshot" ? "Lido da captura" : "Confirmado por você";
  byId("reportActions").hidden = false;
  renderRecommendations(result.recommendations);
}

function renderEmptyState() {
  byId("lastAnalysis").textContent = "Nenhuma análise registrada";
  byId("confidenceBadge").textContent = "AGUARDANDO DADOS";
  byId("confidenceBadge").className = "confidence-badge neutral";
  byId("scoreNumber").textContent = "—";
  byId("scoreStatus").textContent = "Analise capturas dos Ajustes para receber uma avaliação.";
  renderGauge(0, true);
  byId("storageMetric").textContent = "—";
  byId("storageDetail").textContent = "Informe no diagnóstico";
  byId("batteryMetric").textContent = "—";
  byId("batteryDetail").textContent = "Capacidade máxima";
  byId("thermalMetric").textContent = "—";
  byId("thermalDetail").textContent = "Sensação informada";
  byId("reportActions").hidden = true;
  renderRecommendations([]);
}

function renderGauge(score, empty = false, priority = "normal") {
  const progress = byId("scoreProgress");
  progress.setAttribute("stroke-dashoffset", String(empty ? GAUGE_LENGTH : GAUGE_LENGTH * (1 - score / 100)));
  progress.setAttribute("stroke", empty ? "#62758a" : scoreColor(score, priority));
}

function scoreColor(score, priority = "normal") {
  if (priority === "critical" || score < 50) return "#ff6b6b";
  if (priority === "high") return "#ffc857";
  if (score >= 85) return "#46d89b";
  if (score >= 70) return "#20d6c7";
  if (score >= 50) return "#ffc857";
  return "#ff6b6b";
}

function scoreClass(score, priority = "normal") {
  if (priority === "critical") return "score-critical";
  if (priority === "high") return score < 50 ? "score-critical" : "score-attention";
  if (score >= 85) return "score-excellent";
  if (score >= 70) return "score-good";
  if (score >= 50) return "score-attention";
  return "score-critical";
}

function worstPriority(recommendations = []) {
  if (recommendations.some((item) => item.priority === "critical")) return "critical";
  if (recommendations.some((item) => item.priority === "high")) return "high";
  return "normal";
}

function scoreStatus(score) {
  if (score >= 85) return "Excelente — nenhum alerta importante informado.";
  if (score >= 70) return "Bom — existem ajustes recomendados.";
  if (score >= 50) return "Atenção — priorize as recomendações abaixo.";
  return "Intervenção prioritária — comece pelas recomendações de maior prioridade.";
}

function resultStatus(result) {
  const priorities = result?.recommendations?.map((item) => item.priority) || [];
  if (priorities.includes("critical")) return "Intervenção prioritária — siga primeiro os alertas críticos.";
  if (priorities.includes("high") && result.score >= 70) return "Atenção — existe uma prioridade importante mesmo com boa margem geral.";
  const hasUnverifiedData = result?.input?.thermalState === "unknown"
    || result?.input?.updateStatus === "unknown"
    || result?.input?.batteryStatus === "unknown"
    || result?.input?.batteryStatus === "unverified_part";
  if (hasUnverifiedData && result.score >= 85) return "Nenhum alerta nos dados confirmados — ainda há itens não verificados.";
  return scoreStatus(result.score);
}

function renderRecommendations(recommendations) {
  const container = byId("recommendations");
  container.replaceChildren();
  if (!recommendations.length) {
    const empty = document.createElement("article");
    empty.className = "empty-card";
    const title = document.createElement("strong");
    title.textContent = "Diagnóstico ainda não realizado";
    const copy = document.createElement("p");
    copy.textContent = "O Guardião indicará ações específicas sem apagar arquivos nem alterar configurações automaticamente.";
    empty.append(title, copy);
    container.append(empty);
    return;
  }
  recommendations.slice(0, 7).forEach((item, index) => {
    const card = document.createElement("article");
    card.className = `recommendation-card ${item.priority}`;
    card.dataset.number = String(index + 1);
    const title = document.createElement("strong");
    title.textContent = item.title;
    const copy = document.createElement("p");
    copy.textContent = item.body;
    card.append(title, copy);
    container.append(card);
  });
}

function bindTools() {
  byId("shareReport").addEventListener("click", shareLatestReport);
  byId("runMaintenance").addEventListener("click", () => runMaintenanceCheck(true));
  byId("filePicker").addEventListener("change", analyzeSelectedFiles);
  byId("exportHistory").addEventListener("click", exportHistory);
  byId("clearHistory").addEventListener("click", () => byId("confirmDialog").showModal());
  byId("confirmClear").addEventListener("click", async () => {
    try {
      await clearAllAnalyses();
      appState.latest = null;
      appState.history = [];
      renderEmptyState();
      renderHistory();
      byId("historyMetric").textContent = "0";
      updateLocalDataSize();
      showToast("Histórico local apagado. Nenhum dado do iPhone foi removido.");
    } catch {
      showToast("Não foi possível apagar o histórico. Tente novamente ou limpe os dados deste site no Safari.");
    }
  });
}

function bindDialogs() {
  byId("openInstallGuide").addEventListener("click", async () => {
    if (appState.deferredInstallPrompt) {
      appState.deferredInstallPrompt.prompt();
      await appState.deferredInstallPrompt.userChoice;
      appState.deferredInstallPrompt = null;
      return;
    }
    byId("installDialog").showModal();
  });
}

async function analyzeSelectedFiles(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    byId("fileResult").textContent = "Nenhum arquivo selecionado.";
    return;
  }
  const scanner = window.GuardianMaintenance;
  if (!scanner?.scanFiles) {
    byId("fileResult").textContent = "O verificador local não foi carregado. Feche o app, abra novamente com internet e tente outra vez.";
    event.target.value = "";
    return;
  }

  const result = byId("fileResult");
  result.textContent = `Preparando a verificação local de ${files.length} arquivo(s)…`;
  try {
    const summary = await scanner.scanFiles(files, {
      onProgress: ({ current, total }) => {
        result.textContent = `Verificando arquivo ${current} de ${total}… Nenhum conteúdo é enviado.`;
      }
    });
    const findings = [];
    if (summary.emptyFiles) findings.push(`${summary.emptyFiles} vazio(s)`);
    if (summary.unreadableFiles) findings.push(`${summary.unreadableFiles} ilegível(is)`);
    if (summary.possibleDuplicateFiles) findings.push(`${summary.possibleDuplicateFiles} possível(is) duplicado(s) em ${summary.possibleDuplicateGroups} grupo(s)`);
    const status = findings.length ? findings.join(" • ") : "nenhum problema encontrado nas amostras";
    const limit = summary.truncated ? ` • limite seguro: ${summary.checkedFiles} de ${summary.selectedFiles} verificados` : "";
    result.textContent = `${summary.selectedFiles} arquivo(s) • ${formatBytes(summary.totalBytes)} • ${status}${limit}. Leitura local concluída; nomes e amostras foram descartados.`;
  } catch {
    result.textContent = "Não foi possível concluir a verificação. Nenhum arquivo foi alterado.";
  } finally {
    event.target.value = "";
  }
}

async function shareLatestReport() {
  if (!appState.latest) return;
  const text = buildReport(appState.latest);
  try {
    if (navigator.share) {
      await navigator.share({ title: "Relatório Guardião iPhone", text });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      showToast("Relatório copiado.");
    } else {
      downloadText("relatorio-guardiao-iphone.txt", text, "text/plain");
    }
  } catch (error) {
    if (error?.name !== "AbortError") showToast("Não foi possível abrir o compartilhamento.");
  }
}

function buildReport(result) {
  const i = result.input;
  const sourceDescription = result.sourceMethod === "screenshot"
    ? "Capturas lidas localmente e valores confirmados"
    : result.sourceMethod === "screenshot-assisted"
      ? "Capturas lidas localmente com campos complementados ou corrigidos pelo usuário"
      : "Valores preenchidos manualmente";
  const lines = [
    "RELATÓRIO GUARDIÃO IPHONE",
    formatDate(result.createdAt),
    `Modelo configurado pelo proprietário: ${result.model} (não detectado pelo navegador)`,
    "",
    `Índice estimado: ${result.score}/100`,
    `Método: regras locais v${result.rulesVersion || "anterior"}`,
    `Classificação: ${resultStatus(result)}`,
    `Origem: ${sourceDescription}`,
    `Armazenamento: ${formatGb(i.freeStorage)} livres de ${formatGb(i.totalStorage)}`,
    `Capacidade máxima da bateria: ${i.batteryCapacity}%`,
    `Mensagem da bateria: ${batteryLabels[i.batteryStatus] || "Não informada"}`,
    `Temperatura percebida: ${thermalLabels[i.thermalState] || "Não informada"}`,
    "",
    "RECOMENDAÇÕES"
  ];
  if (i.topBatteryApp && i.topBatteryPercent) {
    lines.splice(lines.length - 2, 0, `Maior uso de bateria reconhecido: ${i.topBatteryApp} (${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(i.topBatteryPercent)}%)`);
  }
  result.recommendations.forEach((item, index) => lines.push(`${index + 1}. ${item.title}: ${item.body}`));
  const disclosure = result.sourceMethod === "screenshot"
    ? "Estimativa feita com valores extraídos localmente de capturas escolhidas e confirmados pelo usuário. As imagens e o texto bruto não foram armazenados."
    : result.sourceMethod === "screenshot-assisted"
      ? "Estimativa feita com valores extraídos localmente de capturas e campos complementados ou corrigidos pelo usuário. As imagens e o texto bruto não foram armazenados."
      : "Estimativa feita com dados informados pelo usuário. Nenhum arquivo pessoal foi incluído.";
  lines.push("", disclosure);
  return lines.join("\n");
}

async function exportHistory() {
  if (!appState.history.length) {
    showToast("Não existe histórico para exportar.");
    return;
  }
  const safeExport = appState.history.map((item) => ({
    createdAt: new Date(item.createdAt).toISOString(),
    model: item.model,
    score: item.score,
    rulesVersion: item.rulesVersion || "anterior",
    totalStorage: item.input.totalStorage,
    freeStorage: item.input.freeStorage,
    batteryCapacity: item.input.batteryCapacity,
    batteryStatus: item.input.batteryStatus,
    thermalState: item.input.thermalState,
    symptoms: item.input.symptoms,
    sourceMethod: item.sourceMethod || "manual"
  }));
  downloadText("historico-guardiao-iphone.json", JSON.stringify(safeExport, null, 2), "application/json");
}

function downloadText(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function refreshHistory(render = true) {
  appState.history = await getAllAnalyses();
  appState.latest = appState.history[0] || null;
  byId("historyMetric").textContent = String(appState.history.length);
  renderLatest(appState.latest);
  if (render) renderHistory();
}

function renderHistory() {
  const container = byId("historyList");
  container.replaceChildren();
  if (!appState.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "Nenhuma análise registrada neste aparelho.";
    container.append(empty);
    return;
  }

  appState.history.forEach((item) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "history-item";
    card.setAttribute("aria-label", `Abrir análise de ${formatDate(item.createdAt)}, nota ${item.score}`);

    const score = document.createElement("span");
    score.className = `history-score ${scoreClass(item.score, worstPriority(item.recommendations))}`;
    score.textContent = String(item.score);

    const copy = document.createElement("span");
    copy.className = "history-copy";
    const title = document.createElement("strong");
    title.textContent = formatDate(item.createdAt);
    const detail = document.createElement("small");
    detail.textContent = `${formatGb(item.input.freeStorage)} livres • bateria ${item.input.batteryCapacity}%`;
    copy.append(title, detail);

    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = thermalLabels[item.input.thermalState] || "—";

    card.append(score, copy, meta);
    card.addEventListener("click", () => {
      appState.latest = item;
      renderLatest(item);
      switchView("homeView");
    });
    container.append(card);
  });
}

function configureInstallation() {
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  byId("installBanner").hidden = isStandalone;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    appState.deferredInstallPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    byId("installBanner").hidden = true;
    showToast("Guardião instalado com sucesso.");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then((registration) => registration.update().catch(() => undefined))
      .catch(() => {
        showToast("Não foi possível preparar o modo offline. Reabra com internet e tente novamente.");
      });
  });
}

function restoreMaintenanceStatus() {
  try {
    const stored = JSON.parse(localStorage.getItem(MAINTENANCE_KEY) || "null");
    if (stored?.checkedAt) renderMaintenanceStatus(stored);
  } catch {
    // A verificação atual continua disponível mesmo se o Safari bloquear o armazenamento local.
  }
}

async function maybeRunAutomaticMaintenance() {
  let lastRun = 0;
  try {
    lastRun = Number(JSON.parse(localStorage.getItem(MAINTENANCE_KEY) || "null")?.checkedAt || 0);
  } catch {
    lastRun = 0;
  }
  if (Date.now() - lastRun >= MAINTENANCE_INTERVAL_MS) await runMaintenanceCheck(false);
}

async function runMaintenanceCheck(manual) {
  const button = byId("runMaintenance");
  const target = byId("maintenanceResult");
  button.disabled = true;
  target.textContent = "Verificando dados locais, modo offline, resposta da interface e espaço reservado…";

  const checks = [];
  const details = [];

  try {
    const db = await openDatabase();
    db.close();
    checks.push({ name: "Histórico local", ok: true });
  } catch {
    checks.push({ name: "Histórico local", ok: false });
  }

  if ("serviceWorker" in navigator) {
    const offlineReady = await Promise.race([
      navigator.serviceWorker.ready.then(() => true).catch(() => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 1800))
    ]);
    checks.push({ name: "Modo offline", ok: offlineReady });
  } else {
    checks.push({ name: "Modo offline", ok: false });
  }

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usage = Number(estimate.usage || 0);
      const quota = Number(estimate.quota || 0);
      const ratio = quota > 0 ? usage / quota : 0;
      checks.push({ name: "Espaço do Guardião", ok: !quota || ratio < 0.85 });
      if (quota) details.push(`${formatBytes(Math.max(0, quota - usage))} disponíveis para dados do Guardião`);
    } catch {
      checks.push({ name: "Espaço do Guardião", ok: false });
    }
  } else {
    details.push("cota local não informada pelo Safari");
  }

  const responseStart = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const responseDelay = Math.max(0, Math.round(performance.now() - responseStart));
  checks.push({ name: "Resposta da interface", ok: responseDelay < 180 });
  details.push(`resposta local em ${responseDelay} ms`);

  const failures = checks.filter((check) => !check.ok);
  const report = {
    checkedAt: Date.now(),
    ok: failures.length === 0,
    passed: checks.length - failures.length,
    total: checks.length,
    warnings: failures.map((check) => check.name),
    details
  };
  try {
    localStorage.setItem(MAINTENANCE_KEY, JSON.stringify(report));
  } catch {
    // O resultado ainda é mostrado, mas não persiste se o armazenamento estiver bloqueado.
  }
  renderMaintenanceStatus(report);
  button.disabled = false;
  if (manual) showToast(report.ok ? "Verificação concluída sem alertas." : "Verificação concluída com itens para revisar.");
}

function renderMaintenanceStatus(report) {
  const badge = byId("maintenanceBadge");
  badge.className = `confidence-badge ${report.ok ? "complete" : "warning"}`;
  badge.textContent = report.ok ? "TUDO CERTO" : "REVISAR";
  const status = report.ok
    ? `${report.passed} de ${report.total} verificações concluídas.`
    : `${report.passed} de ${report.total} verificações concluídas; revise ${report.warnings.join(", ")}.`;
  const details = report.details?.length ? ` ${report.details.join(" • ")}.` : "";
  byId("maintenanceResult").textContent = `${formatDate(report.checkedAt)} • ${status}${details}`;
}

async function updateLocalDataSize() {
  const target = byId("localDataSize");
  try {
    const bytes = new Blob([JSON.stringify(appState.history)]).size;
    target.textContent = `${formatBytes(bytes)} de histórico`;
  } catch {
    target.textContent = "Somente dados locais";
  }
}

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

function formatGb(value) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} GB`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: index ? 1 : 0 }).format(value)} ${units[index]}`;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAnalysis(result) {
  const db = await openDatabase();
  await transactionPromise(db, "readwrite", (store) => store.put(result));
  const allItems = await readAllFromDb(db);
  if (allItems.length > MAX_HISTORY) {
    const oldest = allItems.sort((a, b) => a.createdAt - b.createdAt).slice(0, allItems.length - MAX_HISTORY);
    await transactionPromise(db, "readwrite", (store) => oldest.forEach((item) => store.delete(item.id)));
  }
  db.close();
}

async function getAllAnalyses() {
  try {
    const db = await openDatabase();
    const items = await readAllFromDb(db);
    db.close();
    return items.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    showToast("O histórico local não pôde ser lido.");
    return [];
  }
}

async function clearAllAnalyses() {
  const db = await openDatabase();
  await transactionPromise(db, "readwrite", (store) => store.clear());
  db.close();
}

function readAllFromDb(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function transactionPromise(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    action(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

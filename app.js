"use strict";

const DB_NAME = "guardiao-iphone";
const DB_VERSION = 1;
const STORE_NAME = "analyses";
const MAX_HISTORY = 30;
const GAUGE_LENGTH = 314.159;

const thermalLabels = {
  normal: "Normal",
  warm: "Morno",
  hot: "Muito quente",
  warning: "Aviso térmico"
};

const batteryLabels = {
  normal: "Funcionamento normal",
  reduced: "Desempenho reduzido",
  service: "Serviço recomendado",
  unknown: "Não verificado"
};

const symptomLabels = {
  slow: "abertura lenta de aplicativos",
  reload: "recarregamento frequente de aplicativos",
  keyboard: "atraso no teclado ou nos toques",
  restart: "reinícios ou aplicativos fechando"
};

const appState = {
  currentStep: 0,
  latest: null,
  history: [],
  deferredInstallPrompt: null
};

const byId = (id) => document.getElementById(id);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  bindNavigation();
  bindDiagnosis();
  bindDialogs();
  bindTools();
  configureInstallation();
  registerServiceWorker();
  await refreshHistory();
  updateLocalDataSize();
}

function bindNavigation() {
  all(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  byId("headerAnalyze").addEventListener("click", beginDiagnosis);
  byId("startDiagnosis").addEventListener("click", beginDiagnosis);
  byId("newDiagnosis").addEventListener("click", beginDiagnosis);
}

function switchView(viewId) {
  all(".view").forEach((view) => {
    const isActive = view.id === viewId;
    view.hidden = !isActive;
    view.classList.toggle("active", isActive);
  });
  all(".nav-item").forEach((item) => {
    const isActive = item.dataset.view === viewId;
    item.classList.toggle("active", isActive);
    if (isActive) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewId === "historyView") renderHistory();
  if (viewId === "privacyView") updateLocalDataSize();
}

function beginDiagnosis() {
  byId("diagnosisForm").reset();
  appState.currentStep = 0;
  clearValidationMessages();
  renderWizardStep();
  switchView("diagnosisView");
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
      setError("storage", "Selecione a capacidade e informe um espaço disponível válido, menor que o total.");
      return false;
    }
  }
  if (step === 1) {
    const capacity = numericValue("batteryCapacity");
    const status = byId("batteryStatus").value;
    if (!capacity || capacity < 1 || capacity > 100 || !status) {
      setError("battery", "Informe a capacidade máxima entre 1% e 100% e selecione a mensagem do iOS.");
      return false;
    }
  }
  if (step === 2 && !document.querySelector('input[name="thermalState"]:checked')) {
    setError("thermal", "Selecione como está a temperatura do aparelho.");
    return false;
  }
  if (step === 3 && !byId("updateStatus").value) {
    setError("performance", "Informe se existe uma atualização do iOS pendente.");
    return false;
  }
  return true;
}

function setError(key, message) {
  const target = document.querySelector(`[data-error-for="${key}"]`);
  if (target) target.textContent = message;
  showToast(message);
}

function clearValidationMessages() {
  all(".field-error").forEach((node) => { node.textContent = ""; });
  all("select.invalid").forEach((node) => node.classList.remove("invalid"));
}

async function finishDiagnosis(event) {
  event.preventDefault();
  if (!validateStep(3)) return;
  const input = collectFormData();
  const result = calculateDiagnosis(input);
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
  showToast("Diagnóstico concluído e salvo somente neste aparelho.");
}

function collectFormData() {
  return {
    totalStorage: numericValue("totalStorage"),
    freeStorage: numericValue("freeStorage"),
    largestApp: byId("largestApp").value.trim(),
    largestAppSize: numericValue("largestAppSize") || 0,
    batteryCapacity: numericValue("batteryCapacity"),
    batteryStatus: byId("batteryStatus").value,
    fastDrain: byId("fastDrain").checked,
    thermalState: document.querySelector('input[name="thermalState"]:checked')?.value || "normal",
    heatContext: checkedValues("heatContext"),
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
  }

  if (input.freeStorage < 5 || freeRatio < 0.05) {
    score -= 35;
    recommendations.push({
      priority: "critical",
      title: "Armazenamento em nível crítico",
      body: `Restam ${formatGb(input.freeStorage)}. Procure liberar aproximadamente ${formatGb(Math.max(targetFree, 5))} e mantenha ao menos 15% livre.`
    });
  } else if (input.freeStorage < 15 || freeRatio < 0.10) {
    score -= 20;
    recommendations.push({
      priority: "high",
      title: "Aumente a margem de armazenamento",
      body: `Restam ${formatGb(input.freeStorage)}. Revise aplicativos, downloads e vídeos até alcançar cerca de ${formatGb(input.totalStorage * 0.15)} livres.`
    });
  } else if (freeRatio < 0.15) {
    score -= 12;
    recommendations.push({
      priority: "high",
      title: "Armazenamento acima da faixa recomendada",
      body: `Libere aproximadamente ${formatGb(Math.max(targetFree, 1))} para chegar a 15% de espaço livre.`
    });
  }

  if (input.batteryStatus === "service") {
    score -= 25;
    recommendations.push({
      priority: "critical",
      title: "O iOS recomenda serviço na bateria",
      body: "Faça backup e procure a Apple ou uma assistência autorizada. A mensagem do sistema é mais importante que qualquer estimativa deste aplicativo."
    });
  } else if (input.batteryStatus === "reduced") {
    score -= 15;
    recommendations.push({
      priority: "high",
      title: "Desempenho da bateria está reduzido",
      body: "Acompanhe desligamentos, autonomia e a mensagem em Saúde da Bateria. Considere avaliação técnica se houver impacto diário."
    });
  } else if (input.batteryCapacity < 80) {
    score -= 18;
    recommendations.push({
      priority: "high",
      title: "Capacidade máxima abaixo de 80%",
      body: "Isso não confirma defeito sozinho. Verifique a mensagem do próprio iOS e procure avaliação técnica se a autonomia estiver ruim."
    });
  } else if (input.batteryCapacity < 85) {
    score -= 12;
    recommendations.push({
      priority: "high",
      title: "Bateria com desgaste relevante",
      body: "Compare a autonomia nos próximos dias e verifique os aplicativos com maior atividade em Ajustes › Bateria."
    });
  } else if (input.batteryCapacity < 90) {
    score -= 6;
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

  let symptomPenalty = 0;
  if (input.symptoms.includes("slow")) symptomPenalty += 4;
  if (input.symptoms.includes("reload")) symptomPenalty += 3;
  if (input.symptoms.includes("keyboard")) symptomPenalty += 3;
  if (input.symptoms.includes("restart")) symptomPenalty += 9;
  score -= Math.min(symptomPenalty, 15);

  if (input.symptoms.length) {
    const description = input.symptoms.map((item) => symptomLabels[item]).join(", ");
    recommendations.push({
      priority: input.symptoms.includes("restart") ? "high" : "normal",
      title: "Corrija os sintomas de desempenho",
      body: `Você informou ${description}. Reinicie o iPhone, confirme espaço livre e atualize o iOS e os aplicativos antes de medidas mais invasivas.`
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
    recommendations.push({
      priority: "normal",
      title: `Revise o conteúdo de ${input.largestApp}`,
      body: `O aplicativo ocupa ${formatGb(input.largestAppSize)}. Apague downloads ou projetos dentro dele somente após confirmar o backup.`
    });
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
    confidence: "complete",
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
  byId("confidenceBadge").textContent = "DIAGNÓSTICO COMPLETO";
  byId("confidenceBadge").className = "confidence-badge complete";
  byId("scoreNumber").textContent = String(result.score);
  byId("scoreStatus").textContent = scoreStatus(result.score);
  renderGauge(result.score);
  byId("storageMetric").textContent = `${usedPercent}%`;
  byId("storageDetail").textContent = `${formatGb(result.input.freeStorage)} livres`;
  byId("batteryMetric").textContent = `${result.input.batteryCapacity}%`;
  byId("batteryDetail").textContent = batteryLabels[result.input.batteryStatus] || "Informado pelo usuário";
  byId("thermalMetric").textContent = thermalLabels[result.input.thermalState] || "—";
  byId("thermalDetail").textContent = "Informado pelo usuário";
  byId("reportActions").hidden = false;
  renderRecommendations(result.recommendations);
}

function renderEmptyState() {
  byId("lastAnalysis").textContent = "Nenhuma análise registrada";
  byId("confidenceBadge").textContent = "AGUARDANDO DADOS";
  byId("confidenceBadge").className = "confidence-badge neutral";
  byId("scoreNumber").textContent = "—";
  byId("scoreStatus").textContent = "Faça o diagnóstico guiado para receber uma avaliação.";
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

function renderGauge(score, empty = false) {
  const progress = byId("scoreProgress");
  progress.setAttribute("stroke-dashoffset", String(empty ? GAUGE_LENGTH : GAUGE_LENGTH * (1 - score / 100)));
  progress.setAttribute("stroke", empty ? "#62758a" : scoreColor(score));
}

function scoreColor(score) {
  if (score >= 85) return "#46d89b";
  if (score >= 70) return "#20d6c7";
  if (score >= 50) return "#ffc857";
  return "#ff6b6b";
}

function scoreClass(score) {
  if (score >= 85) return "score-excellent";
  if (score >= 70) return "score-good";
  if (score >= 50) return "score-attention";
  return "score-critical";
}

function scoreStatus(score) {
  if (score >= 85) return "Excelente — nenhum alerta importante informado.";
  if (score >= 70) return "Bom — existem ajustes recomendados.";
  if (score >= 50) return "Atenção — priorize as recomendações abaixo.";
  return "Intervenção prioritária — siga primeiro os alertas críticos.";
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
  byId("filePicker").addEventListener("change", analyzeSelectedFiles);
  byId("exportHistory").addEventListener("click", exportHistory);
  byId("clearHistory").addEventListener("click", () => byId("confirmDialog").showModal());
  byId("confirmClear").addEventListener("click", async () => {
    await clearAllAnalyses();
    appState.latest = null;
    appState.history = [];
    renderEmptyState();
    renderHistory();
    byId("historyMetric").textContent = "0";
    updateLocalDataSize();
    showToast("Histórico local apagado. Nenhum dado do iPhone foi removido.");
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
  const total = files.reduce((sum, file) => sum + file.size, 0);
  byId("fileResult").textContent = `${files.length} ${files.length === 1 ? "arquivo selecionado" : "arquivos selecionados"} • ${formatBytes(total)}. Nomes e conteúdo não foram armazenados.`;
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
  const lines = [
    "RELATÓRIO GUARDIÃO IPHONE",
    `${result.model} • ${formatDate(result.createdAt)}`,
    "",
    `Nota estimada: ${result.score}/100`,
    `Armazenamento: ${formatGb(i.freeStorage)} livres de ${formatGb(i.totalStorage)}`,
    `Capacidade máxima da bateria: ${i.batteryCapacity}%`,
    `Mensagem da bateria: ${batteryLabels[i.batteryStatus] || "Não informada"}`,
    `Temperatura percebida: ${thermalLabels[i.thermalState] || "Não informada"}`,
    "",
    "RECOMENDAÇÕES"
  ];
  result.recommendations.forEach((item, index) => lines.push(`${index + 1}. ${item.title}: ${item.body}`));
  lines.push("", "Estimativa feita com dados informados pelo usuário. Nenhum arquivo pessoal foi incluído.");
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
    totalStorage: item.input.totalStorage,
    freeStorage: item.input.freeStorage,
    batteryCapacity: item.input.batteryCapacity,
    batteryStatus: item.input.batteryStatus,
    thermalState: item.input.thermalState,
    symptoms: item.input.symptoms
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
    score.className = `history-score ${scoreClass(item.score)}`;
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
    navigator.serviceWorker.register("./sw.js").catch(() => {
      showToast("O modo offline será ativado no próximo acesso.");
    });
  });
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

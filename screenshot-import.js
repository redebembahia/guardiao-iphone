"use strict";

(function exposeGuardianScreenshotImport(global) {
  const MAX_FILES = 4;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const MAX_EDGE = 1400;
  const MAX_PIXELS = 8_000_000;

  const OCR_OPTIONS = Object.freeze({
    workerPath: "./vendor/worker.min.js",
    corePath: "./vendor/core/",
    langPath: "./vendor/lang/",
    workerBlobURL: false
  });

  function emit(onProgress, update) {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(Object.freeze(update));
    } catch {
      // A interface não pode interromper o processamento do diagnóstico.
    }
  }

  function fileLabel(file, index) {
    const name = typeof file?.name === "string" ? file.name.trim() : "";
    return name || `imagem ${index + 1}`;
  }

  function validateFiles(input) {
    let files;
    try {
      files = Array.from(input || []);
    } catch {
      throw new Error("Não foi possível acessar as imagens selecionadas.");
    }

    if (!files.length) {
      throw new Error("Selecione ao menos uma captura de tela.");
    }
    if (files.length > MAX_FILES) {
      throw new Error("Selecione no máximo 4 imagens por análise.");
    }

    files.forEach((file, index) => {
      const label = fileLabel(file, index);
      if (!(file instanceof Blob) || typeof file.type !== "string" || !file.type.startsWith("image/")) {
        throw new Error(`O arquivo \"${label}\" não é uma imagem compatível.`);
      }
      if (!Number.isFinite(file.size) || file.size <= 0) {
        throw new Error(`A imagem \"${label}\" está vazia ou não pôde ser lida.`);
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`A imagem \"${label}\" ultrapassa o limite de 12 MB.`);
      }
    });

    return files;
  }

  function resizedDimensions(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error("A captura possui dimensões inválidas.");
    }

    const edgeScale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const pixelScale = Math.min(1, Math.sqrt(MAX_PIXELS / (width * height)));
    const scale = Math.min(edgeScale, pixelScale);

    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale))
    };
  }

  async function decodeImage(file, objectUrls) {
    if (typeof global.createImageBitmap === "function") {
      try {
        const bitmap = await global.createImageBitmap(file);
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            release() {
              bitmap.close?.();
            }
          };
        }
        bitmap.close?.();
      } catch {
        // Alguns formatos aceitos pelo Safari não são decodificados por createImageBitmap.
      }
    }

    if (typeof global.Image !== "function" || !global.URL?.createObjectURL) {
      throw new Error("Este navegador não consegue abrir a captura selecionada.");
    }

    const url = global.URL.createObjectURL(file);
    objectUrls.add(url);

    return new Promise((resolve, reject) => {
      const image = new global.Image();
      image.decoding = "async";
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error("A captura possui dimensões inválidas."));
          return;
        }
        resolve({
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
          release() {
            image.onload = null;
            image.onerror = null;
            image.removeAttribute("src");
          }
        });
      };
      image.onerror = () => reject(new Error("O formato da captura não pôde ser decodificado."));
      image.src = url;
    });
  }

  function renderForOcr(decoded, canvases) {
    if (!global.document?.createElement) {
      throw new Error("O processamento de imagens não está disponível neste navegador.");
    }

    const size = resizedDimensions(decoded.width, decoded.height);
    const canvas = global.document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvases.add(canvas);

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Não foi possível preparar a captura para leitura.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function clearCanvas(canvas) {
    try {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 1;
      canvas.height = 1;
    } catch {
      // A limpeza é de melhor esforço e não altera o resultado já calculado.
    }
  }

  function createAbortError() {
    if (typeof global.DOMException === "function") return new global.DOMException("Leitura cancelada.", "AbortError");
    const error = new Error("Leitura cancelada.");
    error.name = "AbortError";
    return error;
  }

  function raceWithAbort(operation, signal, onLateResolve) {
    if (!signal) return Promise.resolve(operation);
    if (signal.aborted) return Promise.reject(createAbortError());

    return new Promise((resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        reject(createAbortError());
      };
      signal.addEventListener("abort", abort, { once: true });

      Promise.resolve(operation).then((value) => {
        if (settled) {
          try {
            onLateResolve?.(value);
          } catch {
            // O resultado tardio já não participa da leitura cancelada.
          }
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      }, (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      });
    });
  }

  async function scan(inputFiles, options = {}) {
    const onProgress = options && typeof options === "object" ? options.onProgress : undefined;
    const signal = options && typeof options === "object" ? options.signal : undefined;
    if (onProgress !== undefined && typeof onProgress !== "function") {
      throw new Error("O acompanhamento do progresso informado é inválido.");
    }
    if (signal !== undefined && (typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      throw new Error("O controle de cancelamento informado é inválido.");
    }
    if (signal?.aborted) throw createAbortError();

    const files = validateFiles(inputFiles);
    const tesseract = global.Tesseract;
    const parsers = global.GuardianParsers;

    if (!tesseract || typeof tesseract.createWorker !== "function") {
      throw new Error("O mecanismo de leitura local não foi carregado. Feche e abra o aplicativo novamente com internet.");
    }
    if (!parsers || typeof parsers.parseScreens !== "function") {
      throw new Error("O analisador das telas do iPhone não foi carregado.");
    }

    let worker = null;
    let activeFile = 0;
    const texts = [];
    const canvases = new Set();
    const objectUrls = new Set();
    const abortWorker = () => {
      if (!worker) return;
      try {
        Promise.resolve(worker.terminate()).catch(() => {});
      } catch {
        // O encerramento final também é tentado no bloco finally.
      }
    };
    signal?.addEventListener("abort", abortWorker, { once: true });

    emit(onProgress, {
      percent: 0,
      title: "Preparando leitura local",
      detail: "Iniciando o reconhecimento de texto no aparelho."
    });

    try {
      const oem = tesseract.OEM?.LSTM_ONLY ?? 1;
      try {
        const workerPromise = tesseract.createWorker("por", oem, {
          ...OCR_OPTIONS,
          logger(message) {
            const localProgress = Number.isFinite(message?.progress) ? message.progress : 0;
            const completedBefore = Math.max(0, activeFile - 1);
            const overallProgress = activeFile
              ? Math.min(1, (completedBefore + localProgress) / files.length)
              : 0;
            emit(onProgress, {
              percent: Math.round(overallProgress * 100),
              title: activeFile ? "Lendo capturas" : "Carregando OCR",
              detail: activeFile
                ? `Captura ${activeFile} de ${files.length}.`
                : "Carregando o mecanismo local de reconhecimento."
            });
          }
        });
        worker = await raceWithAbort(workerPromise, signal, (lateWorker) => {
          Promise.resolve(lateWorker?.terminate?.()).catch(() => {});
        });
        if (signal?.aborted) throw createAbortError();
      } catch {
        if (signal?.aborted) throw createAbortError();
        throw new Error("Não foi possível iniciar o reconhecimento local. Confirme a conexão no primeiro uso e tente novamente.");
      }

      const sparseText = tesseract.PSM?.SPARSE_TEXT ?? "11";
      try {
        await raceWithAbort(worker.setParameters({ tessedit_pageseg_mode: sparseText }), signal);
      } catch {
        throw new Error("O mecanismo de leitura local não pôde ser configurado. Feche e abra o aplicativo novamente.");
      }

      for (let index = 0; index < files.length; index += 1) {
        if (signal?.aborted) throw createAbortError();
        activeFile = index + 1;
        emit(onProgress, {
          percent: Math.round((index / files.length) * 100),
          title: "Preparando captura",
          detail: `Captura ${activeFile} de ${files.length}.`
        });

        let decoded = null;
        let canvas = null;
        try {
          decoded = await raceWithAbort(decodeImage(files[index], objectUrls), signal, (lateImage) => lateImage?.release?.());
          canvas = renderForOcr(decoded, canvases);
          const result = await raceWithAbort(worker.recognize(canvas), signal);
          if (signal?.aborted) throw createAbortError();
          texts.push(typeof result?.data?.text === "string" ? result.data.text : "");
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") throw createAbortError();
          throw new Error(`Não foi possível reconhecer o texto da captura ${activeFile}. Use uma imagem PNG ou JPEG nítida e tente novamente.`);
        } finally {
          decoded?.release?.();
          if (canvas) {
            clearCanvas(canvas);
            canvases.delete(canvas);
          }
        }
      }

      let parsed;
      try {
        if (signal?.aborted) throw createAbortError();
        parsed = await parsers.parseScreens(texts);
      } catch (error) {
        if (signal?.aborted || error?.name === "AbortError") throw createAbortError();
        throw new Error("O texto foi lido, mas não foi possível interpretar os dados. Confirme se as capturas mostram as telas solicitadas.");
      }

      for (let index = 0; index < texts.length; index += 1) texts[index] = "";
      texts.length = 0;

      emit(onProgress, {
        percent: 100,
        title: "Leitura concluída",
        detail: "As capturas foram analisadas com segurança."
      });
      return parsed;
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") throw createAbortError();
      if (error instanceof Error && error.message) throw error;
      throw new Error("Não foi possível concluir a leitura local das capturas.");
    } finally {
      signal?.removeEventListener("abort", abortWorker);
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // Nenhum recurso do worker deve escapar mesmo se o encerramento falhar.
        }
      }
      canvases.forEach(clearCanvas);
      canvases.clear();
      objectUrls.forEach((url) => {
        try {
          global.URL.revokeObjectURL(url);
        } catch {
          // URL já revogada ou indisponível.
        }
      });
      objectUrls.clear();
      for (let index = 0; index < texts.length; index += 1) texts[index] = "";
      texts.length = 0;
      activeFile = 0;
      worker = null;
    }
  }

  global.GuardianScreenshotImport = Object.freeze({ scan });
})(globalThis);

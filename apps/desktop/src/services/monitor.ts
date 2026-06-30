import { invoke } from "@tauri-apps/api/core";
import { recognizeImage, startOcrEngine } from "./ocr";
import { OpenAIProvider, OllamaProvider } from "./llm";
import type { AppConfig, TodoItem, LLMProvider } from "@/types";

/**
 * Main monitoring service that orchestrates:
 * 1. Window monitoring (whitelist check)
 * 2. Screenshot capture
 * 3. OCR recognition
 * 4. LLM todo extraction
 */
export class MonitorService {
  private intervalId: number | null = null;
  private llmProvider: LLMProvider;
  private config: AppConfig;
  private onTodosFound: (todos: TodoItem[]) => void;
  private tickCount = 0;
  private onOcrText?: (text: string) => void;
  private onError?: (message: string) => void;

  constructor(
    config: AppConfig,
    onTodosFound: (todos: TodoItem[]) => void,
    handlers?: {
      onOcrText?: (text: string) => void;
      onError?: (message: string) => void;
    }
  ) {
    this.config = config;
    this.onTodosFound = onTodosFound;
    this.onOcrText = handlers?.onOcrText;
    this.onError = handlers?.onError;

    // Initialize LLM provider
    if (config.llmProvider === "openai" && config.llmConfig.openai) {
      this.llmProvider = new OpenAIProvider(
        config.llmConfig.openai.apiKey,
        config.llmConfig.openai.model,
        config.llmConfig.openai.baseUrl
      );
    } else if (config.llmConfig.ollama) {
      this.llmProvider = new OllamaProvider(
        config.llmConfig.ollama.baseUrl,
        config.llmConfig.ollama.apiKey,
        config.llmConfig.ollama.model
      );
    } else {
      throw new Error("No LLM provider configured");
    }
  }

  /**
   * Start periodic monitoring
   */
  async start() {
    if (this.intervalId) return;

    console.info(
      "[Monitor] starting; interval=%ds whitelist=%o provider=%s",
      this.config.screenshotInterval,
      this.config.whitelist,
      this.llmProvider.name
    );

    // Touch the OCR service once so the UI can report the active backend.
    console.info("[Monitor] preparing OCR engine...");
    await startOcrEngine();
    console.info("[Monitor] OCR engine ready");

    this.intervalId = window.setInterval(
      () => this.tick(),
      this.config.screenshotInterval * 1000
    );

    // Run immediately
    this.tick();
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.info("[MonitorService] stop");
    }
  }

  /**
   * Single monitoring cycle
   */
  private async tick() {
    const tickId = ++this.tickCount;
    const startedAt = Date.now();
    console.debug("[Monitor] tick #%d start", tickId);
    try {
      // 1. Check if configured whitelisted app is in foreground
      const appName = await invoke<string>("get_active_window");
      const isWhitelisted = this.config.whitelist.some(
        (name) => name && appName.includes(name)
      );
      console.debug(
        "[Monitor] active window=%o whitelisted=%s (whitelist=%o)",
        appName,
        isWhitelisted,
        this.config.whitelist
      );
      if (!isWhitelisted) {
        console.debug(
          "[Monitor] skip: front app %o not in whitelist %o",
          appName,
          this.config.whitelist
        );
        return;
      }

      // 2. Capture screenshot
      const imagePath = await invoke<string>("capture_screenshot");
      console.debug("[Monitor] screenshot path=%o", imagePath);
      if (!imagePath) {
        console.warn("[Monitor] skip: empty screenshot path");
        return;
      }

      // 3. OCR recognition
      console.debug("[Monitor] running OCR on %s", imagePath);
      const ocrResult = await recognizeImage(imagePath);
      if (!ocrResult.success) {
        console.error("[Monitor] OCR failed: %o", ocrResult.error);
        if (ocrResult.error) {
          this.onError?.(ocrResult.error);
        }
        return;
      }

      const ocrText = ocrResult.text.trim();
      console.debug(
        "[Monitor] OCR ok: %d chars, %d lines",
        ocrText.length,
        ocrResult.details?.length ?? 0
      );
      if (!ocrText) {
        console.debug("[Monitor] skip: OCR text empty");
        return;
      }
      this.onOcrText?.(ocrText);

      // 4. Extract todos via LLM
      console.debug("[Monitor] extracting todos via %s...", this.llmProvider.name);
      const todos = await this.llmProvider.extractTodos(ocrText);
      console.info("[Monitor] extracted %d todo(s)", todos.length);
      if (todos.length > 0) {
        this.onTodosFound(todos);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.onError?.(message);
      console.error("[Monitor] tick error:", error);
    } finally {
      console.debug("[Monitor] tick done in %dms", Date.now() - startedAt);
    }
  }
}

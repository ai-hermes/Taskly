import { invoke } from "@tauri-apps/api/core";
import { recognizeImage } from "./ocr";
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

  constructor(config: AppConfig, onTodosFound: (todos: TodoItem[]) => void) {
    this.config = config;
    this.onTodosFound = onTodosFound;

    // Initialize LLM provider
    if (config.llmProvider === "openai" && config.llmConfig.openai) {
      this.llmProvider = new OpenAIProvider(
        config.llmConfig.openai.apiKey,
        config.llmConfig.openai.model
      );
    } else if (config.llmConfig.ollama) {
      this.llmProvider = new OllamaProvider(
        config.llmConfig.ollama.baseUrl,
        config.llmConfig.ollama.model
      );
    } else {
      throw new Error("No LLM provider configured");
    }
  }

  /**
   * Start periodic monitoring
   */
  start() {
    if (this.intervalId) return;

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
    }
  }

  /**
   * Single monitoring cycle
   */
  private async tick() {
    try {
      // 1. Check if whitelisted app is in foreground
      const isWhitelisted = await invoke<boolean>("is_whitelisted_app");
      if (!isWhitelisted) return;

      // 2. Capture screenshot
      const imagePath = await invoke<string>("capture_screenshot");
      if (!imagePath) return;

      // 3. OCR recognition
      const ocrResult = await recognizeImage(imagePath);
      if (!ocrResult.success || !ocrResult.text.trim()) return;

      // 4. Extract todos via LLM
      const todos = await this.llmProvider.extractTodos(ocrResult.text);
      if (todos.length > 0) {
        this.onTodosFound(todos);
      }
    } catch (error) {
      console.error("[MonitorService] tick error:", error);
    }
  }
}

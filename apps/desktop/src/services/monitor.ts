import { invoke } from "@tauri-apps/api/core";
import { recognizeImage, startOcrEngine } from "./ocr";
import { OpenAIProvider } from "./llm";
import { hashString, normalizeTitle, FRAME_CACHE_SIZE, FRAME_CACHE_TTL_MS } from "./dedup";
import { filterRegionsByFences, rebuildText } from "./fence";
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
  private getKnownTitles?: () => string[];
  // Frame-level cache of recently-seen normalized OCR hashes (LRU + TTL).
  private frameCache = new Map<string, number>();

  constructor(
    config: AppConfig,
    onTodosFound: (todos: TodoItem[]) => void,
    handlers?: {
      onOcrText?: (text: string) => void;
      onError?: (message: string) => void;
      getKnownTitles?: () => string[];
    }
  ) {
    this.config = config;
    this.onTodosFound = onTodosFound;
    this.onOcrText = handlers?.onOcrText;
    this.onError = handlers?.onError;
    this.getKnownTitles = handlers?.getKnownTitles;

    // Initialize LLM provider
    if (!config.llmConfig.openai) {
      throw new Error("No LLM provider configured");
    }
    this.llmProvider = new OpenAIProvider(
      config.llmConfig.openai.apiKey,
      config.llmConfig.openai.model,
      config.llmConfig.openai.baseUrl
    );
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
      const imagePath = await invoke<string>("capture_screenshot", {
        whitelist: this.config.whitelist,
      });
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

      // 3.6 Apply the per-app capture fence: only regions inside the fence
      // take part in todo extraction (avoids picking up the user's own input
      // box). The full screenshot still serves as evidence.
      let details = ocrResult.details ?? [];
      let fencedText = ocrText;
      const whitelistKey = this.config.whitelist.find(
        (name) => name && appName.includes(name)
      );
      const fences = whitelistKey
        ? this.config.captureFences?.[whitelistKey]
        : undefined;
      if (fences && fences.length > 0 && details.length > 0) {
        const kept = filterRegionsByFences(
          details,
          fences,
          ocrResult.imageWidth ?? 0,
          ocrResult.imageHeight ?? 0
        );
        if (kept !== details) {
          console.debug(
            "[Monitor] fence filter: %d -> %d region(s)",
            details.length,
            kept.length
          );
          details = kept;
          fencedText = rebuildText(kept).trim();
        }
      }
      this.onOcrText?.(fencedText);
      if (!fencedText) {
        console.debug("[Monitor] skip: no OCR text inside capture fence");
        return;
      }

      // 3.7 Frame-level dedup: skip LLM if this OCR frame was seen recently.
      if (this.isRecentFrame(fencedText)) {
        console.debug("[Monitor] skip: OCR frame unchanged (frame cache hit)");
        return;
      }

      // 4. Extract todos via LLM
      console.debug("[Monitor] extracting todos via %s...", this.llmProvider.name);
      const knownTitles = this.getKnownTitles?.() ?? [];
      const todos = await this.llmProvider.extractTodos(fencedText, {
        knownTitles,
        screenshotPath: imagePath,
        ocrDetails: details,
      });
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

  /**
   * Returns true if this OCR frame's normalized hash was seen within the TTL.
   * Records the frame (LRU eviction) as a side effect when it's new.
   */
  private isRecentFrame(ocrText: string): boolean {
    const now = Date.now();
    const key = hashString(normalizeTitle(ocrText));

    // Evict expired entries.
    for (const [k, ts] of this.frameCache) {
      if (now - ts > FRAME_CACHE_TTL_MS) this.frameCache.delete(k);
    }

    const seenAt = this.frameCache.get(key);
    if (seenAt !== undefined && now - seenAt <= FRAME_CACHE_TTL_MS) {
      this.frameCache.set(key, now); // refresh recency
      return true;
    }

    this.frameCache.set(key, now);
    // Enforce LRU capacity (Map preserves insertion order).
    while (this.frameCache.size > FRAME_CACHE_SIZE) {
      const oldest = this.frameCache.keys().next().value;
      if (oldest === undefined) break;
      this.frameCache.delete(oldest);
    }
    return false;
  }
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  done: boolean;
  source: string;
  sourceText?: string;
  priority: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  /** Normalized-title (+ due-day) hash used for deduplication. */
  fingerprint?: string;
}

/** Record of a user-deleted todo, kept for a TTL to block re-detection. */
export interface Tombstone {
  fingerprint: string;
  normalizedTitle: string;
  /** Epoch millis when the todo was deleted. */
  deletedAt: number;
}

export interface OcrResult {
  success: boolean;
  text: string;
  details: Array<{
    text: string;
    confidence: number;
    box: number[][];
  }>;
  error?: string;
}

export interface LLMProvider {
  name: string;
  extractTodos(ocrText: string, knownTitles?: string[]): Promise<TodoItem[]>;
}

export interface AppConfig {
  whitelist: string[];
  screenshotInterval: number; // seconds
  llmProvider: "openai";
  llmConfig: {
    openai?: { baseUrl: string; apiKey: string; model: string };
  };
  syncEnabled: boolean;
  serverUrl: string;
  startupOpenMainWindow: boolean;
  debuggerConsoleEnabled: boolean;
  /** Minutes to block re-detection of a deleted todo (0 disables tombstones). */
  dedupTombstoneTtlMinutes: number;
}

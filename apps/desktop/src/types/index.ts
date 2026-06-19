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
  extractTodos(ocrText: string): Promise<TodoItem[]>;
}

export interface AppConfig {
  whitelist: string[];
  screenshotInterval: number; // seconds
  llmProvider: "openai" | "ollama";
  llmConfig: {
    openai?: { apiKey: string; model: string };
    ollama?: { baseUrl: string; model: string };
  };
  syncEnabled: boolean;
  serverUrl: string;
}

import type { LLMProvider, TodoItem } from "@/types";

const EXTRACT_PROMPT = `你是一个待办事项提取助手。请从以下聊天文本中识别出待办事项。

规则：
1. 只提取明确的任务/待办/要求，不要提取普通对话
2. 每个待办事项包含：title（简短标题）、description（详细描述，可选）、priority（0-3，0最低）
3. 如果文本中提到截止时间，提取为 dueDate（ISO格式）
4. 返回 JSON 数组格式

聊天文本：
---
{text}
---

请返回JSON数组（如果没有待办事项，返回空数组 []）：`;

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractTodos(ocrText: string): Promise<TodoItem[]> {
    const prompt = EXTRACT_PROMPT.replace("{text}", ocrText);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) return [];

    try {
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : parsed.todos || [];
      return items.map((item: any) => ({
        id: crypto.randomUUID(),
        title: item.title,
        description: item.description || "",
        done: false,
        source: "wechat_ocr",
        sourceText: ocrText.slice(0, 200),
        priority: item.priority || 0,
        dueDate: item.dueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }
}

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = "http://localhost:11434", model = "qwen2.5:7b") {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async extractTodos(ocrText: string): Promise<TodoItem[]> {
    const prompt = EXTRACT_PROMPT.replace("{text}", ocrText);

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: "json",
      }),
    });

    const data = await response.json();
    const content = data.response;

    if (!content) return [];

    try {
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : parsed.todos || [];
      return items.map((item: any) => ({
        id: crypto.randomUUID(),
        title: item.title,
        description: item.description || "",
        done: false,
        source: "wechat_ocr",
        sourceText: ocrText.slice(0, 200),
        priority: item.priority || 0,
        dueDate: item.dueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }
}

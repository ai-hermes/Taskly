import type { ExtractTodoOptions, LLMProvider, OcrRegion, TodoItem, TodoKind } from "@/types";
import { fingerprint, normalizeTitle } from "./dedup";

const EXTRACT_PROMPT = `你是一个待办事项提取助手。请从以下聊天文本中识别出待办事项。

规则：
1. 只提取明确的任务/待办/要求，不要提取普通对话
2. 每个待办事项包含：title（简短标题）、description（详细描述，可选）、priority（0-3，0最低）
3. 每个待办事项必须输出 todoKind：actionable（可执行）或 notification（仅通知）
4. 可选输出 evidenceKeywords（字符串数组），用于定位截图中的来源文本
5. 如果文本中提到截止时间，提取为 dueDate（ISO格式）
6. 返回 JSON 数组格式
{known}
聊天文本：
---
{text}
---

请返回JSON数组（如果没有待办事项，返回空数组 []）：`;

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(apiKey = "", model = "gpt-4o-mini", baseUrl = "https://api.openai.com/v1") {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractTodos(ocrText: string, options: ExtractTodoOptions = {}): Promise<TodoItem[]> {
    const knownBlock = buildKnownBlock(options.knownTitles ?? []);
    const prompt = EXTRACT_PROMPT.replace("{known}", knownBlock).replace("{text}", ocrText);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(this.apiKey),
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
      const screenshotPath = options.screenshotPath;
      const ocrDetails = options.ocrDetails ?? [];
      return items.map((item: any) => ({
        id: crypto.randomUUID(),
        title: item.title,
        description: item.description || "",
        done: false,
        source: "wechat_ocr",
        sourceText: ocrText.slice(0, 200),
        priority: item.priority || 0,
        dueDate: item.dueDate,
        reviewStatus: "pending_confirmation",
        todoKind: normalizeTodoKind(item.todoKind),
        sourceEvidence:
          screenshotPath || ocrDetails.length > 0
            ? {
                screenshotPath,
                matchedRegions: matchOcrRegions(
                  ocrDetails,
                  buildEvidenceKeywords(item.evidenceKeywords, item.title)
                ),
              }
            : undefined,
        fingerprint: fingerprint({ title: item.title, dueDate: item.dueDate }),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      return [];
    }

    function normalizeTodoKind(kind: unknown): TodoKind {
      return kind === "notification" ? "notification" : "actionable";
    }

    function buildEvidenceKeywords(raw: unknown, title: string): string[] {
      const fromModel = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const fallback = title?.trim() ? [title.trim()] : [];
      return [...fromModel, ...fallback].slice(0, 8);
    }

    function matchOcrRegions(details: OcrRegion[], keywords: string[]): OcrRegion[] {
      if (!details.length || !keywords.length) return [];
      const normKeywords = keywords
        .map((k) => normalizeTitle(k))
        .filter((k) => k.length > 0)
        .sort((a, b) => b.length - a.length);
      if (normKeywords.length === 0) return [];
      return details
        .filter((region) => {
          const normText = normalizeTitle(region.text);
          return normKeywords.some((keyword) => normText.includes(keyword) || keyword.includes(normText));
        })
        .slice(0, 8);
    }
  }
}


function buildKnownBlock(knownTitles: string[]): string {
  const titles = knownTitles.filter((t) => t && t.trim()).slice(0, 30);
  if (titles.length === 0) return "\n";
  const list = titles.map((t) => `- ${t}`).join("\n");
  return `\n以下待办已存在，请勿重复输出（含语义相近的重复）：\n${list}\n`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey.trim()}`;
  }
  return headers;
}

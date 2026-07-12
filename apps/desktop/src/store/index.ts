import { create } from "zustand";
import type {
  TodoItem,
  AppConfig,
  Tombstone,
  TodoExecutionRecord,
  TodoWorkspaceAsset,
  TodoWorkspaceContext,
  ExecLogEvent,
  ExecPhaseEvent,
  AgentStreamEvent,
  AgentUiRequest,
  AgentUiRequestBody,
  TranscriptEntry,
  ToolCallEntry,
  PermissionMode,
} from "@/types";
import { dedupTodos, dedupPendingTodos, makeTombstone, fingerprint } from "@/services/dedup";

function withTodoDefaults(todo: TodoItem): TodoItem {
  return {
    ...todo,
    reviewStatus: todo.reviewStatus ?? "confirmed",
    todoKind: todo.todoKind ?? "actionable",
    sourceEvidence: todo.sourceEvidence
      ? {
          screenshotPath: todo.sourceEvidence.screenshotPath,
          matchedRegions: todo.sourceEvidence.matchedRegions ?? [],
        }
      : undefined,
  };
}

interface TodoStore {
  todos: TodoItem[];
  tombstones: Tombstone[];
  addTodos: (items: TodoItem[], tombstoneTtlMs?: number) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  confirmTodo: (id: string) => void;
  setTodos: (todos: TodoItem[]) => void;
  setTombstones: (tombstones: Tombstone[]) => void;
  setWorkspace: (id: string, workspace: TodoWorkspaceContext) => void;
  attachWorkspaceAssets: (id: string, assets: TodoWorkspaceAsset[]) => void;
  setTodoWorkdir: (id: string, workdir: string) => void;
  setValidationCommands: (id: string, commands: string[]) => void;
  updateExecutionState: (id: string, patch: Partial<TodoExecutionRecord>) => void;
  markTodoDoneByAgent: (id: string, run: TodoExecutionRecord) => void;
}

function patchTodo(
  todos: TodoItem[],
  id: string,
  fn: (t: TodoItem) => TodoItem
): TodoItem[] {
  return todos.map((t) => (t.id === id ? fn(t) : t));
}

function patchWorkspace(
  todos: TodoItem[],
  id: string,
  fn: (w: TodoWorkspaceContext) => TodoWorkspaceContext
): TodoItem[] {
  return patchTodo(todos, id, (t) =>
    t.workspace
      ? { ...t, workspace: fn(t.workspace), updatedAt: new Date().toISOString() }
      : t
  );
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  tombstones: [],
  addTodos: (items, tombstoneTtlMs = 0) =>
    set((state) => {
      const normalized = items.map(withTodoDefaults);
      const now = Date.now();
      const { added, liveTombstones } = dedupTodos(
        normalized,
        state.todos,
        state.tombstones,
        tombstoneTtlMs,
        now
      );
      if (added.length === 0 && liveTombstones.length === state.tombstones.length) {
        return {};
      }
      return {
        todos: added.length ? [...state.todos, ...added] : state.todos,
        tombstones: liveTombstones,
      };
    }),
  toggleTodo: (id) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id
          ? {
              ...t,
              done: !t.done,
              completedBy: !t.done ? ("manual" as const) : undefined,
              updatedAt: new Date().toISOString(),
            }
          : t
      ),
    })),
  removeTodo: (id) =>
    set((state) => {
      const target = state.todos.find((t) => t.id === id);
      const tombstones = target
        ? [...state.tombstones, makeTombstone(target)]
        : state.tombstones;
      return {
        todos: state.todos.filter((t) => t.id !== id),
        tombstones,
      };
    }),
  updateTodo: (id, patch) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              // Recompute fingerprint when title/dueDate change.
              fingerprint: fingerprint({
                title: patch.title ?? t.title,
                dueDate: patch.dueDate ?? t.dueDate,
              }),
              updatedAt: new Date().toISOString(),
            }
          : t
      ),
    })),
  confirmTodo: (id) =>
    set((state) => ({
      // Confirming a todo also sweeps its remaining pending near-duplicates.
      todos: dedupPendingTodos(
        state.todos.map((t) =>
          t.id === id
            ? {
                ...t,
                reviewStatus: "confirmed",
                updatedAt: new Date().toISOString(),
              }
            : t
        )
      ),
    })),
  setTodos: (todos) =>
    set({
      todos: dedupPendingTodos(
        todos.map((t) => ({
          ...withTodoDefaults(t),
          fingerprint: t.fingerprint || fingerprint(t),
        }))
      ),
    }),
  setTombstones: (tombstones) => set({ tombstones }),
  setWorkspace: (id, workspace) =>
    set((state) => ({
      todos: patchTodo(state.todos, id, (t) => ({
        ...t,
        workspace,
        updatedAt: new Date().toISOString(),
      })),
    })),
  attachWorkspaceAssets: (id, assets) =>
    set((state) => ({
      todos: patchWorkspace(state.todos, id, (w) => ({
        ...w,
        assets: [...w.assets, ...assets],
      })),
    })),
  setTodoWorkdir: (id, workdir) =>
    set((state) => ({
      todos: patchWorkspace(state.todos, id, (w) => ({ ...w, workdir })),
    })),
  setValidationCommands: (id, commands) =>
    set((state) => ({
      todos: patchWorkspace(state.todos, id, (w) => ({
        ...w,
        validationCommands: commands,
      })),
    })),
  updateExecutionState: (id, patch) =>
    set((state) => ({
      todos: patchTodo(state.todos, id, (t) => ({
        ...t,
        execution: { ...(t.execution as TodoExecutionRecord), ...patch },
        updatedAt: new Date().toISOString(),
      })),
    })),
  markTodoDoneByAgent: (id, run) =>
    set((state) => ({
      todos: patchTodo(state.todos, id, (t) => ({
        ...t,
        done: true,
        completedBy: "agent" as const,
        execution: run,
        updatedAt: new Date().toISOString(),
      })),
    })),
}));

interface ConfigStore {
  config: AppConfig;
  updateConfig: (partial: Partial<AppConfig>) => void;
}

const defaultConfig: AppConfig = {
  whitelist: ["微信", "WeChat", "Weixin"],
  captureFences: {},
  screenshotInterval: 30,
  llmProvider: "openai",
  llmConfig: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
    },
  },
  syncEnabled: false,
  serverUrl: "http://localhost:8080",
  startupOpenMainWindow: false,
  debuggerConsoleEnabled: false,
  dedupTombstoneTtlMinutes: 30,
  remindersEnabled: true,
  agentCommand: "",
  agentPermissionMode: "ask",
  agentTimeoutSec: 600,
  workspaceBaseDir: "",
};

export const useConfigStore = create<ConfigStore>((set) => ({
  config: defaultConfig,
  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),
}));

interface AppState {
  monitoring: boolean;
  lastOcrText: string;
  lastMonitorError: string;
  setMonitoring: (v: boolean) => void;
  setLastOcrText: (text: string) => void;
  setLastMonitorError: (text: string) => void;
}

export const useAppState = create<AppState>((set) => ({
  monitoring: false,
  lastOcrText: "",
  lastMonitorError: "",
  setMonitoring: (v) => set({ monitoring: v }),
  setLastOcrText: (text) => set({ lastOcrText: text }),
  setLastMonitorError: (text) => set({ lastMonitorError: text }),
}));

const LOG_BUFFER_LIMIT = 2000;

/** Stable empty references to avoid getSnapshot churn / infinite loops. */
const EMPTY_LOGS: ExecLogEvent[] = [];
const EMPTY_PHASES: ExecPhaseEvent[] = [];
const EMPTY_TRANSCRIPT: TranscriptEntry[] = [];

/** Extract concatenated assistant text from a pi message object. */
function extractMessageText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: string; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join("");
}

/** Pull concatenated text out of a tool result / partialResult payload. */
function extractToolText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const content = (payload as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part && typeof part === "object") {
        const p = part as { type?: string; text?: string };
        if (typeof p.text === "string") return p.text;
      }
      return "";
    })
    .join("");
}

/** One-line, human-friendly summary of a tool call's arguments. */
function summarizeToolArgs(_name: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const pick = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const primary =
    pick("command") ||
    pick("cmd") ||
    pick("path") ||
    pick("file") ||
    pick("filePath") ||
    pick("pattern") ||
    pick("query") ||
    pick("url");
  if (primary) return primary;
  try {
    const s = JSON.stringify(a);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return "";
  }
}

const TOOL_OUTPUT_LIMIT = 8000;

function clampOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) return text;
  return "…" + text.slice(text.length - TOOL_OUTPUT_LIMIT);
}

/** Append any pending thinking + streamed assistant text to a transcript. */
function flushPending(
  transcript: TranscriptEntry[],
  thinkingText: string,
  streamText: string,
  ts: number
): TranscriptEntry[] {
  let out = transcript;
  const think = thinkingText.trim();
  if (think) {
    out = [
      ...out,
      { role: "assistant" as const, kind: "thinking" as const, text: think, ts },
    ];
  }
  const text = streamText.trim();
  if (text) out = [...out, { role: "assistant" as const, text, ts }];
  return out;
}

/** Phrases that signal the agent is asking the user something (CJK + English). */
const QUESTION_HINTS = [
  "请问", "请选择", "请提供", "请告诉", "请确认", "请指定", "请补充", "帮我确认",
  "你想", "您想", "你希望", "您希望", "要不要", "需不需要", "是否需要", "是否要",
  "需要我", "可以吗", "好吗", "行吗", "哪一个", "哪个", "选择哪", "怎么处理",
  "which", "would you like", "should i", "do you want", "let me know",
  "please confirm", "please provide", "please choose", "could you", "can you confirm",
];

/**
 * Heuristic: does this assistant reply end by asking the user for input? Used to
 * tell genuine human-in-the-loop ("等待你的回复") apart from a finished turn
 * ("本轮完成"). Only the tail is inspected so a rhetorical "?" mid-answer or a
 * hint word buried in a long report doesn't trip it.
 */
function looksLikeQuestion(text: string): boolean {
  const tail = text.trim().slice(-160);
  if (!tail) return false;
  if (/[?？]\s*$/.test(tail)) return true;
  const lower = tail.toLowerCase();
  return QUESTION_HINTS.some((h) => lower.includes(h));
}

/** Last assistant message text in the current turn (stops at the user boundary). */
function lastAssistantText(transcript: TranscriptEntry[]): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.role === "user") break;
    if (m.role === "assistant" && m.kind !== "tool" && m.kind !== "thinking") {
      return m.text;
    }
  }
  return "";
}

interface ExecutionLiveStore {
  /** Live log lines per todo (ring buffer). */
  logs: Record<string, ExecLogEvent[]>;
  /** Phase timeline per todo for the current/last run. */
  phases: Record<string, ExecPhaseEvent[]>;
  /** Accumulated assistant text of the in-flight turn, per todo. */
  streams: Record<string, string>;
  /** Accumulated thinking text of the in-flight turn, per todo. */
  thinking: Record<string, string>;
  /** Multi-turn transcript per todo. */
  transcripts: Record<string, TranscriptEntry[]>;
  /** Tool invocations keyed by toolCallId, per todo. */
  toolCalls: Record<string, Record<string, ToolCallEntry>>;
  /** Selected permission mode per todo (falls back to config default). */
  permissionModes: Record<string, PermissionMode>;
  /** Pending interactive request from the agent, per todo. */
  uiRequests: Record<string, AgentUiRequestBody | null>;
  /** Whether the agent is actively producing output, per todo. */
  streaming: Record<string, boolean>;
  /** Whether the run is idle after a turn (agent handed control back), per todo. */
  waiting: Record<string, boolean>;
  /**
   * Whether the agent is genuinely blocked on the user (a structured UI request,
   * or a turn that ended with a question) vs. just finished its work. Lets the UI
   * distinguish real human-in-the-loop from "task complete".
   */
  awaitingReply: Record<string, boolean>;
  /** Todo id whose chat session is active in the right pane, if any. */
  activeTodoId: string | null;
  appendLog: (e: ExecLogEvent) => void;
  appendPhase: (e: ExecPhaseEvent) => void;
  appendAgentEvent: (e: AgentStreamEvent) => void;
  setUiRequest: (e: AgentUiRequest) => void;
  clearUiRequest: (todoId: string) => void;
  pushUserTurn: (todoId: string, text: string) => void;
  setWaiting: (todoId: string, waiting: boolean) => void;
  setPermissionMode: (todoId: string, mode: PermissionMode) => void;
  /** Flush any in-flight stream and stop the streaming/waiting spinners. */
  endStream: (todoId: string) => void;
  resetRun: (todoId: string) => void;
  /** Reset run state for a re-run while keeping the conversation history. */
  startNewRun: (todoId: string) => void;
  /** Replace the whole transcript map (used to rehydrate persisted history). */
  hydrateTranscripts: (transcripts: Record<string, TranscriptEntry[]>) => void;
  /** Replace the tool-call map (used to rehydrate persisted tool details). */
  hydrateToolCalls: (
    toolCalls: Record<string, Record<string, ToolCallEntry>>
  ) => void;
  setActiveTodo: (todoId: string | null) => void;
}

export const useExecutionStore = create<ExecutionLiveStore>((set) => ({
  logs: {},
  phases: {},
  streams: {},
  thinking: {},
  transcripts: {},
  toolCalls: {},
  permissionModes: {},
  uiRequests: {},
  streaming: {},
  waiting: {},
  awaitingReply: {},
  activeTodoId: null,
  appendLog: (e) =>
    set((state) => {
      const buf = [...(state.logs[e.todoId] ?? EMPTY_LOGS), e];
      if (buf.length > LOG_BUFFER_LIMIT) buf.splice(0, buf.length - LOG_BUFFER_LIMIT);
      return { logs: { ...state.logs, [e.todoId]: buf } };
    }),
  appendPhase: (e) =>
    set((state) => ({
      phases: {
        ...state.phases,
        [e.todoId]: [...(state.phases[e.todoId] ?? EMPTY_PHASES), e],
      },
    })),
  appendAgentEvent: (e) =>
    set((state) => {
      const { todoId } = e;
      const ev = e.event;
      const type = ev.type;
      switch (type) {
        case "agent_start":
        case "turn_start":
          return {
            streaming: { ...state.streaming, [todoId]: true },
            waiting: { ...state.waiting, [todoId]: false },
            awaitingReply: { ...state.awaitingReply, [todoId]: false },
          };
        case "message_start":
          return { streaming: { ...state.streaming, [todoId]: true } };
        case "message_update":
        case "message_end": {
          // Streaming thinking deltas arrive on message_update; accumulate them
          // into a live thinking buffer rendered as a collapsible block.
          const ame = ev.assistantMessageEvent;
          if (ame && typeof ame.type === "string" && ame.type.startsWith("thinking")) {
            if (ame.type === "thinking_delta" && typeof ame.delta === "string") {
              const prev = state.thinking[todoId] ?? "";
              return { thinking: { ...state.thinking, [todoId]: prev + ame.delta } };
            }
            if (
              ame.type === "thinking_end" &&
              typeof ame.content === "string" &&
              ame.content
            ) {
              return { thinking: { ...state.thinking, [todoId]: ame.content } };
            }
            return {};
          }
          // A model/provider failure (e.g. 404, no API key, overload) arrives
          // as an assistant message with stopReason "error". Surface it in the
          // timeline instead of silently swallowing it (which looked "stuck").
          const msg = ev.message as
            | { role?: string; stopReason?: string; errorMessage?: string }
            | undefined;
          if (
            type === "message_end" &&
            msg?.role === "assistant" &&
            msg?.stopReason === "error"
          ) {
            const errText =
              typeof msg.errorMessage === "string" && msg.errorMessage
                ? msg.errorMessage
                : "模型返回错误";
            const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
            return {
              streams: { ...state.streams, [todoId]: "" },
              transcripts: {
                ...state.transcripts,
                [todoId]: [
                  ...transcript,
                  { role: "system" as const, text: `⚠ ${errText}`, ts: e.ts },
                ],
              },
            };
          }
          const text = extractMessageText(ev.message);
          if (!text) return {};
          // Only the assistant's own output belongs in the streaming buffer. pi
          // echoes the user's reply (and tool messages) back as message events
          // too; without this guard the user's input renders as an Agent bubble.
          const role = msg?.role;
          if (role && role !== "assistant") return {};
          return { streams: { ...state.streams, [todoId]: text } };
        }
        case "text": {
          // Fallback for streamed plain-text deltas.
          if (typeof ev.text !== "string" || !ev.text) return {};
          const prev = state.streams[todoId] ?? "";
          return { streams: { ...state.streams, [todoId]: prev + ev.text } };
        }
        case "tool_execution_start": {
          // Flush any pending thinking/assistant text first for chronology,
          // then create a live tool card keyed by toolCallId.
          const id =
            typeof ev.toolCallId === "string" && ev.toolCallId
              ? ev.toolCallId
              : `tool-${e.ts}`;
          const toolName =
            typeof ev.toolName === "string" && ev.toolName ? ev.toolName : "工具";
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const flushed = flushPending(
            transcript,
            state.thinking[todoId] ?? "",
            state.streams[todoId] ?? "",
            e.ts
          );
          const entry: ToolCallEntry = {
            id,
            name: toolName,
            args: ev.args,
            argsSummary: summarizeToolArgs(toolName, ev.args),
            output: "",
            status: "running",
            ts: e.ts,
          };
          const todoTools = state.toolCalls[todoId] ?? {};
          return {
            streams: { ...state.streams, [todoId]: "" },
            thinking: { ...state.thinking, [todoId]: "" },
            toolCalls: {
              ...state.toolCalls,
              [todoId]: { ...todoTools, [id]: entry },
            },
            transcripts: {
              ...state.transcripts,
              [todoId]: [
                ...flushed,
                {
                  role: "system" as const,
                  kind: "tool" as const,
                  toolName,
                  toolCallId: id,
                  text: toolName,
                  ts: e.ts,
                },
              ],
            },
          };
        }
        case "tool_execution_update": {
          const id = typeof ev.toolCallId === "string" ? ev.toolCallId : "";
          const existing = state.toolCalls[todoId]?.[id];
          if (!existing) return {};
          const output = clampOutput(extractToolText(ev.partialResult));
          return {
            toolCalls: {
              ...state.toolCalls,
              [todoId]: {
                ...state.toolCalls[todoId],
                [id]: { ...existing, output },
              },
            },
          };
        }
        case "tool_execution_end": {
          const id = typeof ev.toolCallId === "string" ? ev.toolCallId : "";
          const existing = state.toolCalls[todoId]?.[id];
          if (!existing) return {};
          const isError = ev.isError === true;
          const output = clampOutput(extractToolText(ev.result) || existing.output || "");
          return {
            toolCalls: {
              ...state.toolCalls,
              [todoId]: {
                ...state.toolCalls[todoId],
                [id]: {
                  ...existing,
                  output,
                  isError,
                  status: isError ? "error" : "ok",
                },
              },
            },
          };
        }
        case "tool_call": {
          // Legacy/coarse tool event kept as a fallback when the granular
          // tool_execution_* stream is unavailable.
          const id = typeof ev.toolCallId === "string" && ev.toolCallId ? ev.toolCallId : "";
          if (id && state.toolCalls[todoId]?.[id]) return {};
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const toolName =
            typeof ev.toolName === "string" && ev.toolName ? ev.toolName : "工具";
          const flushed = flushPending(
            transcript,
            state.thinking[todoId] ?? "",
            state.streams[todoId] ?? "",
            e.ts
          );
          return {
            streams: { ...state.streams, [todoId]: "" },
            thinking: { ...state.thinking, [todoId]: "" },
            transcripts: {
              ...state.transcripts,
              [todoId]: [
                ...flushed,
                {
                  role: "system" as const,
                  kind: "tool" as const,
                  toolName,
                  text: toolName,
                  ts: e.ts,
                },
              ],
            },
          };
        }
        case "agent_end": {
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const nextTranscript = flushPending(
            transcript,
            state.thinking[todoId] ?? "",
            state.streams[todoId] ?? "",
            e.ts
          );
          // The turn ended. Only flag it as "awaiting your reply" when the agent
          // actually asked something; otherwise it's a completed turn, not a
          // human-in-the-loop block.
          const asked = looksLikeQuestion(lastAssistantText(nextTranscript));
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: true },
            awaitingReply: { ...state.awaitingReply, [todoId]: asked },
            streams: { ...state.streams, [todoId]: "" },
            thinking: { ...state.thinking, [todoId]: "" },
            transcripts: { ...state.transcripts, [todoId]: nextTranscript },
          };
        }
        case "session_shutdown":
          return { streaming: { ...state.streaming, [todoId]: false } };
        case "auto_retry_start": {
          // pi hit a retryable error (connection dropped, overload, 5xx) and is
          // silently retrying with backoff. Make it visible so the run doesn't
          // look frozen, and keep the spinner alive (the agent IS still busy).
          const attempt = typeof ev.attempt === "number" ? ev.attempt : undefined;
          const max = typeof ev.maxAttempts === "number" ? ev.maxAttempts : undefined;
          const emsg =
            typeof ev.errorMessage === "string" && ev.errorMessage
              ? ev.errorMessage
              : "";
          const counter =
            attempt !== undefined && max !== undefined
              ? `（第 ${attempt}/${max} 次）`
              : "";
          const note = `⟳ 连接/服务异常，正在自动重试${counter}${emsg ? "：" + emsg : ""}`;
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const flushed = flushPending(
            transcript,
            state.thinking[todoId] ?? "",
            state.streams[todoId] ?? "",
            e.ts
          );
          return {
            streaming: { ...state.streaming, [todoId]: true },
            waiting: { ...state.waiting, [todoId]: false },
            streams: { ...state.streams, [todoId]: "" },
            thinking: { ...state.thinking, [todoId]: "" },
            transcripts: {
              ...state.transcripts,
              [todoId]: [
                ...flushed,
                { role: "system" as const, text: note, ts: e.ts },
              ],
            },
          };
        }
        case "auto_retry_end": {
          // success === true just means the retry recovered; let the normal
          // event stream continue. A failed end (retries exhausted / cancelled)
          // is terminal for the turn - surface why and hand control back.
          if (ev.success === true) return {};
          const fe =
            typeof ev.finalError === "string" && ev.finalError
              ? ev.finalError
              : "自动重试失败";
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: true },
            awaitingReply: { ...state.awaitingReply, [todoId]: false },
            transcripts: {
              ...state.transcripts,
              [todoId]: [
                ...transcript,
                { role: "system" as const, text: `✖ ${fe}`, ts: e.ts },
              ],
            },
          };
        }
        case "error": {
          // Flush any partial thinking/assistant text, then record the error as
          // a system turn so the timeline surfaces why the run stopped.
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const errText =
            typeof ev.error === "string" && ev.error
              ? ev.error
              : "执行出错";
          const flushed = flushPending(
            transcript,
            state.thinking[todoId] ?? "",
            state.streams[todoId] ?? "",
            e.ts
          );
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: false },
            awaitingReply: { ...state.awaitingReply, [todoId]: false },
            streams: { ...state.streams, [todoId]: "" },
            thinking: { ...state.thinking, [todoId]: "" },
            transcripts: {
              ...state.transcripts,
              [todoId]: [
                ...flushed,
                { role: "system" as const, text: errText, ts: e.ts },
              ],
            },
          };
        }
        default:
          return {};
      }
    }),
  setUiRequest: (e) =>
    set((state) => ({
      uiRequests: { ...state.uiRequests, [e.todoId]: e.request },
      waiting: { ...state.waiting, [e.todoId]: true },
      awaitingReply: { ...state.awaitingReply, [e.todoId]: true },
    })),
  clearUiRequest: (todoId) =>
    set((state) => ({ uiRequests: { ...state.uiRequests, [todoId]: null } })),
  pushUserTurn: (todoId, text) =>
    set((state) => ({
      transcripts: {
        ...state.transcripts,
        [todoId]: [
          ...(state.transcripts[todoId] ?? EMPTY_TRANSCRIPT),
          { role: "user" as const, text, ts: Date.now() },
        ],
      },
      waiting: { ...state.waiting, [todoId]: false },
      awaitingReply: { ...state.awaitingReply, [todoId]: false },
      streaming: { ...state.streaming, [todoId]: true },
    })),
  setWaiting: (todoId, waiting) =>
    set((state) => ({
      waiting: { ...state.waiting, [todoId]: waiting },
      awaitingReply: { ...state.awaitingReply, [todoId]: waiting },
    })),
  setPermissionMode: (todoId, mode) =>
    set((state) => ({
      permissionModes: { ...state.permissionModes, [todoId]: mode },
    })),
  endStream: (todoId) =>
    set((state) => {
      const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
      const nextTranscript = flushPending(
        transcript,
        state.thinking[todoId] ?? "",
        state.streams[todoId] ?? "",
        Date.now()
      );
      return {
        streaming: { ...state.streaming, [todoId]: false },
        waiting: { ...state.waiting, [todoId]: false },
        awaitingReply: { ...state.awaitingReply, [todoId]: false },
        streams: { ...state.streams, [todoId]: "" },
        thinking: { ...state.thinking, [todoId]: "" },
        transcripts: { ...state.transcripts, [todoId]: nextTranscript },
      };
    }),
  resetRun: (todoId) =>
    set((state) => ({
      logs: { ...state.logs, [todoId]: EMPTY_LOGS },
      phases: { ...state.phases, [todoId]: EMPTY_PHASES },
      streams: { ...state.streams, [todoId]: "" },
      thinking: { ...state.thinking, [todoId]: "" },
      transcripts: { ...state.transcripts, [todoId]: EMPTY_TRANSCRIPT },
      toolCalls: { ...state.toolCalls, [todoId]: {} },
      uiRequests: { ...state.uiRequests, [todoId]: null },
      streaming: { ...state.streaming, [todoId]: false },
      waiting: { ...state.waiting, [todoId]: false },
      awaitingReply: { ...state.awaitingReply, [todoId]: false },
    })),
  startNewRun: (todoId) =>
    set((state) => {
      // Reset the ephemeral run state but KEEP the conversation history so a
      // re-run appends below the previous turns instead of erasing them.
      const prev = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
      const nextTranscript = prev.length
        ? [
            ...prev,
            { role: "system" as const, text: "重新执行", ts: Date.now() },
          ]
        : prev;
      return {
        logs: { ...state.logs, [todoId]: EMPTY_LOGS },
        phases: { ...state.phases, [todoId]: EMPTY_PHASES },
        streams: { ...state.streams, [todoId]: "" },
        thinking: { ...state.thinking, [todoId]: "" },
        transcripts: { ...state.transcripts, [todoId]: nextTranscript },
        toolCalls: { ...state.toolCalls, [todoId]: {} },
        uiRequests: { ...state.uiRequests, [todoId]: null },
        streaming: { ...state.streaming, [todoId]: false },
        waiting: { ...state.waiting, [todoId]: false },
        awaitingReply: { ...state.awaitingReply, [todoId]: false },
      };
    }),
  hydrateTranscripts: (transcripts) => set({ transcripts }),
  hydrateToolCalls: (toolCalls) => set({ toolCalls }),
  setActiveTodo: (todoId) => set({ activeTodoId: todoId }),
}));

// See services/agent.ts: decline HMR to avoid a split-brain store where stale
// Tauri listeners update an orphaned instance. A full reload keeps a single
// source of truth for execution state.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

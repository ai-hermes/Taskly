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
} from "@/types";
import { dedupTodos, makeTombstone, fingerprint } from "@/services/dedup";

interface TodoStore {
  todos: TodoItem[];
  tombstones: Tombstone[];
  addTodos: (items: TodoItem[], tombstoneTtlMs?: number) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
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
      const now = Date.now();
      const { added, liveTombstones } = dedupTodos(
        items,
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
  setTodos: (todos) =>
    set({
      todos: todos.map((t) => ({
        ...t,
        fingerprint: t.fingerprint || fingerprint(t),
      })),
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
  copilotVisible: boolean;
  lastOcrText: string;
  lastMonitorError: string;
  setMonitoring: (v: boolean) => void;
  setCopilotVisible: (v: boolean) => void;
  setLastOcrText: (text: string) => void;
  setLastMonitorError: (text: string) => void;
}

export const useAppState = create<AppState>((set) => ({
  monitoring: false,
  copilotVisible: true,
  lastOcrText: "",
  lastMonitorError: "",
  setMonitoring: (v) => set({ monitoring: v }),
  setCopilotVisible: (v) => set({ copilotVisible: v }),
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

interface ExecutionLiveStore {
  /** Live log lines per todo (ring buffer). */
  logs: Record<string, ExecLogEvent[]>;
  /** Phase timeline per todo for the current/last run. */
  phases: Record<string, ExecPhaseEvent[]>;
  /** Accumulated assistant text of the in-flight turn, per todo. */
  streams: Record<string, string>;
  /** Multi-turn transcript per todo. */
  transcripts: Record<string, TranscriptEntry[]>;
  /** Pending interactive request from the agent, per todo. */
  uiRequests: Record<string, AgentUiRequestBody | null>;
  /** Whether the agent is actively producing output, per todo. */
  streaming: Record<string, boolean>;
  /** Whether the run is idle waiting for the user, per todo. */
  waiting: Record<string, boolean>;
  /** Todo id whose chat session is active in the right pane, if any. */
  activeTodoId: string | null;
  appendLog: (e: ExecLogEvent) => void;
  appendPhase: (e: ExecPhaseEvent) => void;
  appendAgentEvent: (e: AgentStreamEvent) => void;
  setUiRequest: (e: AgentUiRequest) => void;
  clearUiRequest: (todoId: string) => void;
  pushUserTurn: (todoId: string, text: string) => void;
  setWaiting: (todoId: string, waiting: boolean) => void;
  /** Flush any in-flight stream and stop the streaming/waiting spinners. */
  endStream: (todoId: string) => void;
  resetRun: (todoId: string) => void;
  /** Reset run state for a re-run while keeping the conversation history. */
  startNewRun: (todoId: string) => void;
  /** Replace the whole transcript map (used to rehydrate persisted history). */
  hydrateTranscripts: (transcripts: Record<string, TranscriptEntry[]>) => void;
  setActiveTodo: (todoId: string | null) => void;
}

export const useExecutionStore = create<ExecutionLiveStore>((set) => ({
  logs: {},
  phases: {},
  streams: {},
  transcripts: {},
  uiRequests: {},
  streaming: {},
  waiting: {},
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
          };
        case "message_start":
          return { streaming: { ...state.streaming, [todoId]: true } };
        case "message_update":
        case "message_end": {
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
          return { streams: { ...state.streams, [todoId]: text } };
        }
        case "text": {
          // Fallback for streamed plain-text deltas.
          if (typeof ev.text !== "string" || !ev.text) return {};
          const prev = state.streams[todoId] ?? "";
          return { streams: { ...state.streams, [todoId]: prev + ev.text } };
        }
        case "tool_call": {
          // Flush accumulated assistant text first to keep chronology, then
          // record the tool call as a timeline entry.
          const current = (state.streams[todoId] ?? "").trim();
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const toolName =
            typeof ev.toolName === "string" && ev.toolName ? ev.toolName : "工具";
          const flushed = current
            ? [...transcript, { role: "assistant" as const, text: current, ts: e.ts }]
            : transcript;
          return {
            streams: { ...state.streams, [todoId]: "" },
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
          const current = (state.streams[todoId] ?? "").trim();
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const nextTranscript = current
            ? [
                ...transcript,
                { role: "assistant" as const, text: current, ts: e.ts },
              ]
            : transcript;
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: true },
            streams: { ...state.streams, [todoId]: "" },
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
          const current = (state.streams[todoId] ?? "").trim();
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const flushed = current
            ? [...transcript, { role: "assistant" as const, text: current, ts: e.ts }]
            : transcript;
          return {
            streaming: { ...state.streaming, [todoId]: true },
            waiting: { ...state.waiting, [todoId]: false },
            streams: { ...state.streams, [todoId]: "" },
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
          // is terminal for the turn — surface why and hand control back.
          if (ev.success === true) return {};
          const fe =
            typeof ev.finalError === "string" && ev.finalError
              ? ev.finalError
              : "自动重试失败";
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: true },
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
          // Flush any partial assistant text, then record the error as a
          // system turn so the timeline surfaces why the run stopped.
          const current = (state.streams[todoId] ?? "").trim();
          const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
          const errText =
            typeof ev.error === "string" && ev.error
              ? ev.error
              : "执行出错";
          const flushed = current
            ? [...transcript, { role: "assistant" as const, text: current, ts: e.ts }]
            : transcript;
          return {
            streaming: { ...state.streaming, [todoId]: false },
            waiting: { ...state.waiting, [todoId]: false },
            streams: { ...state.streams, [todoId]: "" },
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
      streaming: { ...state.streaming, [todoId]: true },
    })),
  setWaiting: (todoId, waiting) =>
    set((state) => ({ waiting: { ...state.waiting, [todoId]: waiting } })),
  endStream: (todoId) =>
    set((state) => {
      const current = (state.streams[todoId] ?? "").trim();
      const transcript = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
      const nextTranscript = current
        ? [...transcript, { role: "assistant" as const, text: current, ts: Date.now() }]
        : transcript;
      return {
        streaming: { ...state.streaming, [todoId]: false },
        waiting: { ...state.waiting, [todoId]: false },
        streams: { ...state.streams, [todoId]: "" },
        transcripts: { ...state.transcripts, [todoId]: nextTranscript },
      };
    }),
  resetRun: (todoId) =>
    set((state) => ({
      logs: { ...state.logs, [todoId]: EMPTY_LOGS },
      phases: { ...state.phases, [todoId]: EMPTY_PHASES },
      streams: { ...state.streams, [todoId]: "" },
      transcripts: { ...state.transcripts, [todoId]: EMPTY_TRANSCRIPT },
      uiRequests: { ...state.uiRequests, [todoId]: null },
      streaming: { ...state.streaming, [todoId]: false },
      waiting: { ...state.waiting, [todoId]: false },
    })),
  startNewRun: (todoId) =>
    set((state) => {
      // Reset the ephemeral run state but KEEP the conversation history so a
      // re-run appends below the previous turns instead of erasing them.
      const prev = state.transcripts[todoId] ?? EMPTY_TRANSCRIPT;
      const nextTranscript = prev.length
        ? [
            ...prev,
            { role: "system" as const, text: "—— 重新执行 ——", ts: Date.now() },
          ]
        : prev;
      return {
        logs: { ...state.logs, [todoId]: EMPTY_LOGS },
        phases: { ...state.phases, [todoId]: EMPTY_PHASES },
        streams: { ...state.streams, [todoId]: "" },
        transcripts: { ...state.transcripts, [todoId]: nextTranscript },
        uiRequests: { ...state.uiRequests, [todoId]: null },
        streaming: { ...state.streaming, [todoId]: false },
        waiting: { ...state.waiting, [todoId]: false },
      };
    }),
  hydrateTranscripts: (transcripts) => set({ transcripts }),
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

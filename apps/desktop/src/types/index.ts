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
  /** Per-todo workspace context for agent execution. */
  workspace?: TodoWorkspaceContext;
  /** Latest agent execution record. */
  execution?: TodoExecutionRecord;
  /** How the todo was completed. */
  completedBy?: "manual" | "agent";
}

export type TodoExecutionStatus =
  | "idle"
  | "workspace_ready"
  | "running"
  | "waiting_input"
  | "validating"
  | "needs_review"
  | "succeeded"
  | "failed";

/** Permission posture for a run, cycled with Shift+Tab (craft-style). */
export type PermissionMode = "explore" | "ask" | "auto";

/** Review dimension layered on top of execution status. */
export type ReviewState = "needs_review" | "accepted";

export type ToolCallStatus = "running" | "ok" | "error";

/** A single tool invocation with its args, streamed output and final result. */
export interface ToolCallEntry {
  /** pi `toolCallId`, used to correlate start/update/end events. */
  id: string;
  name: string;
  /** One-line human summary for the collapsed card header. */
  argsSummary?: string;
  /** Full argument object as sent to the tool. */
  args?: unknown;
  /** Accumulated (streaming) or final textual output. */
  output?: string;
  isError?: boolean;
  status: ToolCallStatus;
  ts: number;
}

export type FileDiffStatus = "added" | "modified" | "deleted" | "renamed";

/** Per-file change for a run, parsed from `git diff`. */
export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileDiffStatus;
  additions: number;
  deletions: number;
  /** Unified diff hunks for this file (empty for binary). */
  patch: string;
  binary?: boolean;
}

/** All file changes produced by a run/turn. */
export interface RunDiff {
  files: FileDiff[];
  generatedAt: string;
}

export interface TodoWorkspaceAsset {
  id: string;
  name: string;
  sourcePath: string;
  copiedPath: string;
  sizeBytes: number;
  mimeType: string;
  addedAt: string;
}

export interface TodoWorkspaceContext {
  workspaceId: string;
  /** Long-lived per-todo workspace directory. */
  workspacePath: string;
  /** Directory the agent runs in (a project dir or the workspace itself). */
  workdir: string;
  assets: TodoWorkspaceAsset[];
  /** Shell commands run sequentially after the agent; all must pass. */
  validationCommands: string[];
  lastPreparedAt: string;
}

export interface ValidationResult {
  command: string;
  exitCode: number;
  ok: boolean;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
}

export interface TodoExecutionRecord {
  runId: string;
  status: TodoExecutionStatus;
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  logTail?: string;
  /** Full run log file path inside the workspace, for troubleshooting. */
  logFilePath?: string;
  error?: string;
  validationResults?: ValidationResult[];
  /** Multi-turn conversation transcript for interactive runs. */
  transcript?: TranscriptEntry[];
  /** Permission posture the run was executed under. */
  permissionMode?: PermissionMode;
  /** Review dimension: set to needs_review after validations pass. */
  reviewState?: ReviewState;
  /** File changes captured from the workspace for this run. */
  diff?: RunDiff;
}

/** One entry in an interactive run's conversation history. */
export interface TranscriptEntry {
  role: "user" | "assistant" | "system";
  text: string;
  ts: number;
  /** Entry kind; plain chat text by default. */
  kind?: "text" | "tool" | "thinking";
  /** Tool name when kind === "tool". */
  toolName?: string;
  /** pi toolCallId when kind === "tool"; key into the toolCalls map. */
  toolCallId?: string;
}

/** A structured event forwarded from the pi rpc session (raw event JSON). */
export interface AgentStreamEvent {
  runId: string;
  todoId: string;
  event: AgentRpcEvent;
  ts: number;
}

/** Loosely-typed pi rpc event; only `type` is guaranteed present. */
export interface AgentRpcEvent {
  type: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  message?: unknown;
  error?: string;
  /** Tool execution payloads (tool_execution_start/update/end). */
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
  /** Streaming delta wrapper on message_update events. */
  assistantMessageEvent?: {
    type: string;
    delta?: string;
    content?: string;
    [key: string]: unknown;
  };
  /** Auto-retry bookkeeping (auto_retry_start / auto_retry_end). */
  attempt?: number;
  maxAttempts?: number;
  errorMessage?: string;
  finalError?: string;
  success?: boolean;
  [key: string]: unknown;
}

/** An interactive request from the agent needing a user answer. */
export interface AgentUiRequest {
  runId: string;
  todoId: string;
  request: AgentUiRequestBody;
  ts: number;
}

export interface AgentUiRequestBody {
  type: "extension_ui_request";
  id: string;
  method:
    | "select"
    | "confirm"
    | "input"
    | "editor"
    | "notify"
    | "setStatus"
    | "setWidget"
    | "setTitle"
    | "set_editor_text";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  notifyType?: "info" | "warning" | "error";
}

/** Live log line streamed from the backend during execution. */
export interface ExecLogEvent {
  runId: string;
  todoId: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
  ts: number;
}

/** Phase transition streamed from the backend during execution. */
export interface ExecPhaseEvent {
  runId: string;
  todoId: string;
  phase:
    | "preparing"
    | "agent_running"
    | "waiting_input"
    | "validating"
    | "done"
    | "failed";
  /** Optional detail, e.g. current validation command. */
  detail?: string;
  ts: number;
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
  /** Whether to fire a system notification when a todo's dueDate arrives. */
  remindersEnabled: boolean;
  /** Custom agent command; empty string means use the bundled sidecar. */
  agentCommand: string;
  /** Default permission posture for agent runs. */
  agentPermissionMode: PermissionMode;
  /** Max seconds for a single agent run before it is killed. */
  agentTimeoutSec: number;
  /** Base dir for per-todo workspaces; empty means app data dir default. */
  workspaceBaseDir: string;
}

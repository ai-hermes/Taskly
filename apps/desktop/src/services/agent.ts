import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTodoStore, useConfigStore, useExecutionStore } from "@/store";
import type {
  ExecLogEvent,
  ExecPhaseEvent,
  AgentStreamEvent,
  AgentUiRequest,
  TodoExecutionRecord,
  TodoExecutionStatus,
  TodoWorkspaceAsset,
  TodoWorkspaceContext,
  ValidationResult,
} from "@/types";

let initPromise: Promise<void> | null = null;
let unlisteners: UnlistenFn[] = [];

/** Map a backend phase to the todo's execution badge status. */
function phaseToStatus(phase: ExecPhaseEvent["phase"]): TodoExecutionStatus | null {
  switch (phase) {
    case "agent_running":
      return "running";
    case "waiting_input":
      return "waiting_input";
    case "validating":
      return "validating";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/** Subscribe once to backend execution events; feeds the live store. */
export function initExecutionListeners(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      unlisteners = [
        await listen<ExecLogEvent>("todo-exec://log", (e) => {
          useExecutionStore.getState().appendLog(e.payload);
        }),
        await listen<ExecPhaseEvent>("todo-exec://phase", (e) => {
          useExecutionStore.getState().appendPhase(e.payload);
          // Keep the todo's execution badge in sync while a run is in flight.
          const { todoId, runId, phase, detail } = e.payload;
          const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
          const status = phaseToStatus(phase);
          const live =
            todo?.execution?.runId === runId &&
            todo.execution.status !== "succeeded" &&
            todo.execution.status !== "failed";
          if (status && live) {
            const patch: Partial<TodoExecutionRecord> = { status };
            // A terminal failure coming straight from the backend (e.g. the
            // agent process crashed) must record the reason and stop the run.
            if (status === "failed") {
              patch.finishedAt = nowIso();
              if (detail) patch.error = detail;
              useExecutionStore.getState().endStream(todoId);
            }
            useTodoStore.getState().updateExecutionState(todoId, patch);
          }
        }),
        await listen<AgentStreamEvent>("todo-exec://agent-event", (e) => {
          useExecutionStore.getState().appendAgentEvent(e.payload);
        }),
        await listen<AgentUiRequest>("todo-exec://ui-request", (e) => {
          useExecutionStore.getState().setUiRequest(e.payload);
        }),
      ];
    })();
  }
  return initPromise;
}

export async function disposeExecutionListeners(): Promise<void> {
  const pending = initPromise;
  initPromise = null;
  if (!pending) return;
  // Wait for the in-flight listen() calls to resolve before unsubscribing,
  // otherwise a StrictMode mount/unmount race leaks a duplicate listener set.
  await pending;
  unlisteners.forEach((u) => u());
  unlisteners = [];
}

/** Result contract returned by the Rust `execute_todo_once` command. */
export interface ExecuteTodoResult {
  runId: string;
  agentOk: boolean;
  agentExitCode: number | null;
  validationResults: ValidationResult[];
  summary: string;
  logTail: string;
  logFilePath: string;
  error: string | null;
}

interface PreparedWorkspace {
  workspaceId: string;
  workspacePath: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Ensure a long-lived workspace directory exists for the todo and record it
 * in the store. Idempotent: re-preparing keeps existing assets/commands.
 */
export async function prepareWorkspace(
  todoId: string,
  preferredWorkdir?: string
): Promise<TodoWorkspaceContext> {
  const { config } = useConfigStore.getState();
  const store = useTodoStore.getState();
  const todo = store.todos.find((t) => t.id === todoId);
  const prepared = await invoke<PreparedWorkspace>("prepare_todo_workspace", {
    todoId,
    todoTitle: todo?.title ?? todoId,
    baseDir: config.workspaceBaseDir || null,
  });

  const existing = todo?.workspace;
  const workspace: TodoWorkspaceContext = {
    workspaceId: prepared.workspaceId,
    workspacePath: prepared.workspacePath,
    workdir: preferredWorkdir || existing?.workdir || prepared.workspacePath,
    assets: existing?.assets ?? [],
    validationCommands: existing?.validationCommands ?? [],
    lastPreparedAt: nowIso(),
  };
  store.setWorkspace(todoId, workspace);
  if (todo && !todo.execution) {
    store.updateExecutionState(todoId, {
      runId: "",
      status: "workspace_ready",
      startedAt: nowIso(),
    });
  }
  return workspace;
}

/** Copy user-picked files into the todo workspace and record them. */
export async function attachAssets(
  todoId: string,
  sourcePaths: string[]
): Promise<TodoWorkspaceAsset[]> {
  const { config } = useConfigStore.getState();
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  const assets = await invoke<TodoWorkspaceAsset[]>(
    "copy_assets_to_workspace",
    {
      todoId,
      todoTitle: todo?.title ?? todoId,
      baseDir: config.workspaceBaseDir || null,
      sourcePaths,
    }
  );
  useTodoStore.getState().attachWorkspaceAssets(todoId, assets);
  return assets;
}

/**
 * Resolve the workspace to run a todo in. If the user never picked one, fall
 * back to an auto-created default workspace directory (`~/.taskly/workspace/…`)
 * so execution can start with zero setup instead of being blocked.
 */
async function ensureWorkspace(todoId: string): Promise<TodoWorkspaceContext> {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  if (!todo) throw new Error("待办不存在");
  if (todo.workspace?.workdir) return todo.workspace;
  return prepareWorkspace(todoId);
}

/**
 * Guard errors surfaced to the UI before an execution is attempted. A missing
 * workspace is NOT an error anymore — it is auto-provisioned on demand (see
 * `ensureWorkspace`), so we only block on genuinely unrecoverable conditions.
 */
export function validateReadyToExecute(todoId: string): string | null {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  if (!todo) return "待办不存在";
  return null;
}

function buildPrompt(title: string, description: string | undefined, assets: TodoWorkspaceAsset[]): string {
  const lines = [
    `请完成以下待办事项：${title}`,
  ];
  if (description) lines.push(`详细描述：${description}`);
  if (assets.length > 0) {
    lines.push(
      "相关参考资料（已复制到工作区 assets/ 目录）：",
      ...assets.map((a) => `- ${a.copiedPath}`)
    );
  }
  return lines.join("\n");
}

/**
 * Execute a single todo once: agent run -> validation chain.
 * Marks the todo done only when the agent succeeds AND all validations pass.
 */
export async function executeTodo(todoId: string): Promise<ExecuteTodoResult> {
  const workspace = await ensureWorkspace(todoId);

  const store = useTodoStore.getState();
  const { config } = useConfigStore.getState();
  const todo = store.todos.find((t) => t.id === todoId)!;
  const runId = `run-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const startedAt = nowIso();

  useExecutionStore.getState().resetRun(todoId);
  store.updateExecutionState(todoId, {
    runId,
    status: "running",
    startedAt,
    finishedAt: undefined,
    summary: undefined,
    error: undefined,
    validationResults: undefined,
  });

  let result: ExecuteTodoResult;
  try {
    result = await invoke<ExecuteTodoResult>("execute_todo_once", {
      req: {
        runId,
        todoId,
        workspacePath: workspace.workspacePath,
        workdir: workspace.workdir,
        prompt: buildPrompt(todo.title, todo.description, workspace.assets),
        agentCommand: config.agentCommand || null,
        timeoutSec: config.agentTimeoutSec,
        safeMode: true,
        validationCommands: workspace.validationCommands,
        llm: config.llmConfig.openai
          ? {
              provider: config.llmProvider,
              model: config.llmConfig.openai.model,
              apiKey: config.llmConfig.openai.apiKey,
              baseUrl: config.llmConfig.openai.baseUrl,
            }
          : null,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useTodoStore.getState().updateExecutionState(todoId, {
      runId,
      status: "failed",
      finishedAt: nowIso(),
      error: message,
    });
    throw e;
  }

  const finishedAt = nowIso();
  const allValidationsOk = result.validationResults.every((v) => v.ok);
  const succeeded = result.agentOk && allValidationsOk && !result.error;

  const record: TodoExecutionRecord = {
    runId: result.runId,
    status: succeeded ? "succeeded" : "failed",
    startedAt,
    finishedAt,
    summary: result.summary,
    logTail: result.logTail,
    logFilePath: result.logFilePath,
    error: result.error ?? undefined,
    validationResults: result.validationResults,
  };

  if (succeeded) {
    useTodoStore.getState().markTodoDoneByAgent(todoId, record);
  } else {
    useTodoStore.getState().updateExecutionState(todoId, record);
  }
  return result;
}

// ============================================================================
// Interactive (human-in-the-loop) orchestration via pi `--mode rpc`.
// ============================================================================

interface StartSessionResult {
  runId: string;
  logFilePath: string;
}

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function llmPayload() {
  const { config } = useConfigStore.getState();
  return config.llmConfig.openai
    ? {
        provider: config.llmProvider,
        model: config.llmConfig.openai.model,
        apiKey: config.llmConfig.openai.apiKey,
        baseUrl: config.llmConfig.openai.baseUrl,
      }
    : null;
}

/** Resolve the live runId for a todo, throwing a friendly error if absent. */
function requireRunId(todoId: string): string {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  const runId = todo?.execution?.runId;
  if (!runId) throw new Error("当前没有进行中的会话");
  return runId;
}

/**
 * Start a long-lived interactive agent session. The agent may pause and ask
 * questions; the user drives the conversation and clicks 完成并校验 to finish.
 */
export async function startInteractiveRun(
  todoId: string
): Promise<StartSessionResult> {
  const workspace = await ensureWorkspace(todoId);

  const store = useTodoStore.getState();
  const { config } = useConfigStore.getState();
  const todo = store.todos.find((t) => t.id === todoId)!;
  const runId = newRunId();
  const startedAt = nowIso();

  useExecutionStore.getState().startNewRun(todoId);
  store.updateExecutionState(todoId, {
    runId,
    status: "running",
    startedAt,
    finishedAt: undefined,
    summary: undefined,
    error: undefined,
    validationResults: undefined,
    transcript: [],
  });

  try {
    return await invoke<StartSessionResult>("start_agent_session", {
      req: {
        runId,
        todoId,
        workspacePath: workspace.workspacePath,
        workdir: workspace.workdir,
        prompt: buildPrompt(todo.title, todo.description, workspace.assets),
        agentCommand: config.agentCommand || null,
        safeMode: true,
        llm: llmPayload(),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useTodoStore.getState().updateExecutionState(todoId, {
      runId,
      status: "failed",
      finishedAt: nowIso(),
      error: message,
    });
    throw e;
  }
}

/**
 * Send a free-text reply to continue the conversation.
 *
 * pi RPC semantics:
 * - prompt: normal user turn (idle / waiting_input)
 * - steer: queue while streaming, delivered after current assistant turn
 * - follow_up: queue for "after agent fully finishes" workflows
 *
 * For this chat UX, user-replies after "等待你的回复" should be a normal prompt.
 */
export async function replyToAgent(todoId: string, text: string): Promise<void> {
  const message = text.trim();
  if (!message) return;
  const runId = requireRunId(todoId);
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  const status = todo?.execution?.status;
  const streaming = useExecutionStore.getState().streaming[todoId] ?? false;
  // Default to prompt so replies after waiting_input immediately start a turn.
  const kind = streaming || status === "running" || status === "validating"
    ? "steer"
    : "prompt";
  useExecutionStore.getState().pushUserTurn(todoId, message);
  useTodoStore.getState().updateExecutionState(todoId, { status: "running" });
  await invoke("send_agent_message", { runId, message, kind });
}

/** Answer a structured extension UI request (select/confirm/input/editor). */
export async function answerUiRequest(
  todoId: string,
  requestId: string,
  payload: { value?: string; confirmed?: boolean; cancelled?: boolean }
): Promise<void> {
  const runId = requireRunId(todoId);
  useExecutionStore.getState().setWaiting(todoId, false);
  useTodoStore.getState().updateExecutionState(todoId, { status: "running" });
  try {
    await invoke("respond_agent_ui", {
      runId,
      requestId,
      value: payload.value ?? null,
      confirmed: payload.confirmed ?? null,
      cancelled: payload.cancelled ?? null,
    });
    useExecutionStore.getState().clearUiRequest(todoId);
  } catch (e) {
    // Keep the UI request visible so the user can retry instead of getting
    // stuck in a fake "处理中" state when the response fails to send.
    useExecutionStore.getState().setWaiting(todoId, true);
    useTodoStore.getState().updateExecutionState(todoId, { status: "waiting_input" });
    throw e;
  }
}

/** Interrupt the agent's current turn without ending the session. */
export async function abortTurn(todoId: string): Promise<void> {
  const runId = requireRunId(todoId);
  await invoke("abort_agent_turn", { runId });
}

/**
 * End the interactive session, run the validation chain, and mark the todo
 * done only if all validations pass (or none are configured).
 */
export async function finishRun(todoId: string): Promise<ExecuteTodoResult> {
  const store = useTodoStore.getState();
  const todo = store.todos.find((t) => t.id === todoId);
  const runId = todo?.execution?.runId;
  if (!runId) throw new Error("当前没有进行中的会话");
  const workspace = todo!.workspace!;
  const startedAt = todo!.execution?.startedAt ?? nowIso();

  store.updateExecutionState(todoId, { status: "validating" });

  let result: ExecuteTodoResult;
  try {
    result = await invoke<ExecuteTodoResult>("finish_agent_session", {
      runId,
      validationCommands: workspace.validationCommands,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useTodoStore.getState().updateExecutionState(todoId, {
      runId,
      status: "failed",
      finishedAt: nowIso(),
      error: message,
    });
    throw e;
  }

  const finishedAt = nowIso();
  const allOk = result.validationResults.every((v) => v.ok);
  const succeeded = allOk && !result.error;
  const transcript = useExecutionStore.getState().transcripts[todoId];

  const record: TodoExecutionRecord = {
    runId: result.runId,
    status: succeeded ? "succeeded" : "failed",
    startedAt,
    finishedAt,
    summary: result.summary,
    logTail: result.logTail,
    logFilePath: result.logFilePath,
    error: result.error ?? undefined,
    validationResults: result.validationResults,
    transcript,
  };

  if (succeeded) {
    useTodoStore.getState().markTodoDoneByAgent(todoId, record);
  } else {
    useTodoStore.getState().updateExecutionState(todoId, record);
  }
  return result;
}

/** Abandon the run entirely: kill the agent, no validation, mark failed. */
export async function cancelRun(todoId: string): Promise<void> {
  const todo = useTodoStore.getState().todos.find((t) => t.id === todoId);
  const runId = todo?.execution?.runId;
  if (!runId) return;
  try {
    await invoke("cancel_agent_session", { runId });
  } finally {
    useTodoStore.getState().updateExecutionState(todoId, {
      runId,
      status: "failed",
      finishedAt: nowIso(),
      error: "已放弃",
    });
  }
}

// Dev-only: these listeners hold long-lived Tauri subscriptions bound to the
// store instance. A hot-reload of this module (or the store) can leave stale
// subscriptions writing to an orphaned store instance while the UI reads a new
// one — a split-brain that looks like a frozen "执行中". Decline HMR so any edit
// triggers a clean full reload instead of half-swapping the runtime.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

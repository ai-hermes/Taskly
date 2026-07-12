import { beforeEach, describe, expect, it } from "vitest";
import { useTodoStore, useExecutionStore } from "./index";
import type { TodoItem, TodoExecutionRecord, TodoWorkspaceContext } from "@/types";

function makeTodo(id: string, patch: Partial<TodoItem> = {}): TodoItem {
  const now = new Date().toISOString();
  return {
    id,
    title: `todo ${id}`,
    done: false,
    source: "test",
    priority: 0,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

function makeWorkspace(): TodoWorkspaceContext {
  return {
    workspaceId: "ws-1",
    workspacePath: "/tmp/ws-1",
    workdir: "/tmp/ws-1",
    assets: [],
    validationCommands: [],
    lastPreparedAt: new Date().toISOString(),
  };
}

describe("todo execution store", () => {
  beforeEach(() => {
    useTodoStore.setState({ todos: [], tombstones: [] });
  });

  it("sets workspace and transitions idle -> workspace_ready", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a")]);
    s.setWorkspace("a", makeWorkspace());
    s.updateExecutionState("a", {
      runId: "",
      status: "workspace_ready",
      startedAt: new Date().toISOString(),
    });
    const todo = useTodoStore.getState().todos[0];
    expect(todo.workspace?.workspacePath).toBe("/tmp/ws-1");
    expect(todo.execution?.status).toBe("workspace_ready");
  });

  it("transitions running -> validating -> succeeded via markTodoDoneByAgent", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a")]);
    s.setWorkspace("a", makeWorkspace());
    s.updateExecutionState("a", {
      runId: "r1",
      status: "running",
      startedAt: new Date().toISOString(),
    });
    expect(useTodoStore.getState().todos[0].execution?.status).toBe("running");

    s.updateExecutionState("a", { status: "validating" });
    expect(useTodoStore.getState().todos[0].execution?.status).toBe("validating");

    const record: TodoExecutionRecord = {
      runId: "r1",
      status: "succeeded",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      summary: "ok",
      validationResults: [
        {
          command: "true",
          exitCode: 0,
          ok: true,
          stdoutTail: "",
          stderrTail: "",
          durationMs: 5,
        },
      ],
    };
    s.markTodoDoneByAgent("a", record);
    const todo = useTodoStore.getState().todos[0];
    expect(todo.done).toBe(true);
    expect(todo.completedBy).toBe("agent");
    expect(todo.execution?.status).toBe("succeeded");
    expect(todo.execution?.summary).toBe("ok");
  });

  it("keeps todo pending on failed run", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a")]);
    s.setWorkspace("a", makeWorkspace());
    s.updateExecutionState("a", {
      runId: "r2",
      status: "failed",
      startedAt: new Date().toISOString(),
      error: "校验失败: pnpm test",
    });
    const todo = useTodoStore.getState().todos[0];
    expect(todo.done).toBe(false);
    expect(todo.execution?.status).toBe("failed");
    expect(todo.execution?.error).toContain("校验失败");
  });

  it("manual toggle records completedBy manual and coexists with agent runs", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a"), makeTodo("b")]);
    s.toggleTodo("a");
    expect(useTodoStore.getState().todos.find((t) => t.id === "a")?.completedBy).toBe(
      "manual"
    );
    // Un-toggling clears completedBy.
    s.toggleTodo("a");
    expect(
      useTodoStore.getState().todos.find((t) => t.id === "a")?.completedBy
    ).toBeUndefined();
  });

  it("hydrates default reviewStatus and todoKind for legacy todos", () => {
    const s = useTodoStore.getState();
    s.setTodos([
      makeTodo("legacy", {
        // Simulate pre-migration payload without new fields.
        reviewStatus: undefined,
        todoKind: undefined,
      }),
    ]);
    const todo = useTodoStore.getState().todos[0];
    expect(todo.reviewStatus).toBe("confirmed");
    expect(todo.todoKind).toBe("actionable");
  });

  it("can confirm a pending-captured todo", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a", { reviewStatus: "pending_confirmation" })]);
    s.confirmTodo("a");
    expect(useTodoStore.getState().todos[0].reviewStatus).toBe("confirmed");
  });

  it("sweeps near-duplicate pending todos on hydration", () => {
    const s = useTodoStore.getState();
    s.setTodos([
      makeTodo("kept", {
        title: "回复设计评审邮件",
        reviewStatus: "confirmed",
      }),
      makeTodo("dup-of-confirmed", {
        title: "回复设计评审邮件！",
        reviewStatus: "pending_confirmation",
      }),
      makeTodo("p1", {
        title: "整理 Dragonfly v2 文档",
        reviewStatus: "pending_confirmation",
      }),
      makeTodo("p2", {
        title: "记得整理 Dragonfly v2 文档！",
        reviewStatus: "pending_confirmation",
      }),
    ]);
    const ids = useTodoStore.getState().todos.map((t) => t.id);
    expect(ids).toEqual(["kept", "p1"]);
  });

  it("confirming a todo removes its pending near-duplicates", () => {
    const s = useTodoStore.getState();
    useTodoStore.setState({
      todos: [
        makeTodo("a", {
          title: "去小邮局取快递",
          reviewStatus: "pending_confirmation",
        }),
        makeTodo("b", {
          title: "记得去小邮局取快递",
          reviewStatus: "pending_confirmation",
        }),
      ],
      tombstones: [],
    });
    s.confirmTodo("a");
    const todos = useTodoStore.getState().todos;
    expect(todos).toHaveLength(1);
    expect(todos[0].id).toBe("a");
    expect(todos[0].reviewStatus).toBe("confirmed");
  });

  it("deduplicates newly captured todos against active confirmed and pending history", () => {
    const s = useTodoStore.getState();
    s.setTodos([
      makeTodo("confirmed", {
        title: "测试GPT-5.6效果,对比fable5效果",
        reviewStatus: "confirmed",
      }),
      makeTodo("pending", {
        title: "准备 kubeflow 相关资料",
        reviewStatus: "pending_confirmation",
      }),
    ]);

    s.addTodos([
      makeTodo("dup-confirmed", {
        title: "测评 GPT-5.6 效果，对比 fable5 效果",
        reviewStatus: "pending_confirmation",
      }),
      makeTodo("dup-pending", {
        title: "准备一下 kubeflow 相关资料",
        reviewStatus: "pending_confirmation",
      }),
      makeTodo("fresh", {
        title: "整理 dragonfly v2 新变更",
        reviewStatus: "pending_confirmation",
      }),
    ]);

    expect(useTodoStore.getState().todos.map((todo) => todo.id)).toEqual([
      "confirmed",
      "pending",
      "fresh",
    ]);
  });

  it("does not block newly captured todos with completed history", () => {
    const s = useTodoStore.getState();
    s.setTodos([
      makeTodo("done-history", {
        title: "准备 pi agent 分享",
        done: true,
        reviewStatus: "confirmed",
      }),
    ]);

    s.addTodos([
      makeTodo("new-active", {
        title: "准备 pi agent 分享",
        reviewStatus: "pending_confirmation",
      }),
    ]);

    expect(useTodoStore.getState().todos.map((todo) => todo.id)).toEqual([
      "done-history",
      "new-active",
    ]);
  });

  it("workspace helpers update workdir, commands and assets", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a")]);
    s.setWorkspace("a", makeWorkspace());
    s.setTodoWorkdir("a", "/repo");
    s.setValidationCommands("a", ["pnpm test", "pnpm build"]);
    s.attachWorkspaceAssets("a", [
      {
        id: "as1",
        name: "spec.docx",
        sourcePath: "/Users/x/spec.docx",
        copiedPath: "/tmp/ws-1/assets/spec.docx",
        sizeBytes: 100,
        mimeType: "application/msword",
        addedAt: new Date().toISOString(),
      },
    ]);
    const w = useTodoStore.getState().todos[0].workspace!;
    expect(w.workdir).toBe("/repo");
    expect(w.validationCommands).toEqual(["pnpm test", "pnpm build"]);
    expect(w.assets).toHaveLength(1);
  });

  it("workspace helpers are no-ops without a workspace", () => {
    const s = useTodoStore.getState();
    s.setTodos([makeTodo("a")]);
    s.setTodoWorkdir("a", "/repo");
    expect(useTodoStore.getState().todos[0].workspace).toBeUndefined();
  });
});

describe("interactive execution store", () => {
  beforeEach(() => {
    useExecutionStore.setState({
      logs: {},
      phases: {},
      streams: {},
      transcripts: {},
      uiRequests: {},
      streaming: {},
      waiting: {},
      awaitingReply: {},
      activeTodoId: null,
    });
  });

  it("accumulates streamed text then flushes to transcript on agent_end", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: { type: "agent_start" },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 2,
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "选 A 还是 B?" }] },
      },
    });
    expect(useExecutionStore.getState().streams["a"]).toBe("选 A 还是 B?");
    expect(useExecutionStore.getState().streaming["a"]).toBe(true);

    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 3,
      event: { type: "agent_end", messages: [] },
    });
    const st = useExecutionStore.getState();
    expect(st.streaming["a"]).toBe(false);
    expect(st.waiting["a"]).toBe(true);
    // The reply ends with "?", so it reads as a genuine question → awaiting reply.
    expect(st.awaitingReply["a"]).toBe(true);
    expect(st.streams["a"]).toBe("");
    expect(st.transcripts["a"]).toEqual([
      { role: "assistant", text: "选 A 还是 B?", ts: 3 },
    ]);
  });

  it("agent_end on a non-question turn is complete, not awaiting reply", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: { type: "agent_start" },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 2,
      event: {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "PPT 已生成，保存到 ~/Desktop/rl.pptx。" }],
        },
      },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 3,
      event: { type: "agent_end", messages: [] },
    });
    const st = useExecutionStore.getState();
    expect(st.waiting["a"]).toBe(true);
    // Turn finished with a statement, not a question → not blocked on the user.
    expect(st.awaitingReply["a"]).toBe(false);
  });

  it("ignores echoed user/tool message events in the assistant stream", () => {
    const s = useExecutionStore.getState();
    // pi echoes the just-sent user reply back as a message event; it must not
    // land in the assistant streaming buffer (which renders as an Agent bubble).
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: {
        type: "message_update",
        message: { role: "user", content: [{ type: "text", text: "可以" }] },
      },
    });
    expect(useExecutionStore.getState().streams["a"] ?? "").toBe("");
  });

  it("pushUserTurn appends a user turn and resumes streaming", () => {
    const s = useExecutionStore.getState();
    s.setWaiting("a", true);
    s.pushUserTurn("a", "选 A");
    const st = useExecutionStore.getState();
    expect(st.transcripts["a"][0]).toMatchObject({ role: "user", text: "选 A" });
    expect(st.waiting["a"]).toBe(false);
    expect(st.streaming["a"]).toBe(true);
  });

  it("setUiRequest marks waiting and clearUiRequest resets it", () => {
    const s = useExecutionStore.getState();
    s.setUiRequest({
      runId: "r1",
      todoId: "a",
      ts: 1,
      request: {
        type: "extension_ui_request",
        id: "u1",
        method: "select",
        title: "选择方案",
        options: ["A", "B"],
      },
    });
    expect(useExecutionStore.getState().uiRequests["a"]?.id).toBe("u1");
    expect(useExecutionStore.getState().waiting["a"]).toBe(true);
    s.clearUiRequest("a");
    expect(useExecutionStore.getState().uiRequests["a"]).toBeNull();
  });

  it("resetRun clears all interactive state for a todo", () => {
    const s = useExecutionStore.getState();
    s.pushUserTurn("a", "hi");
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: { type: "text", text: "partial" },
    });
    s.resetRun("a");
    const st = useExecutionStore.getState();
    expect(st.transcripts["a"]).toEqual([]);
    expect(st.streams["a"]).toBe("");
    expect(st.waiting["a"]).toBe(false);
    expect(st.streaming["a"]).toBe(false);
  });

  it("tool_call flushes pending text then records a tool timeline entry", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: { type: "text", text: "我先看下文件" },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 2,
      event: { type: "tool_call", toolName: "read_file" },
    });
    const st = useExecutionStore.getState();
    expect(st.streams["a"]).toBe("");
    expect(st.transcripts["a"]).toEqual([
      { role: "assistant", text: "我先看下文件", ts: 2 },
      { role: "system", kind: "tool", toolName: "read_file", text: "read_file", ts: 2 },
    ]);
  });

  it("setActiveTodo selects and clears the active chat session", () => {
    const s = useExecutionStore.getState();
    s.setActiveTodo("a");
    expect(useExecutionStore.getState().activeTodoId).toBe("a");
    s.setActiveTodo(null);
    expect(useExecutionStore.getState().activeTodoId).toBeNull();
  });

  it("surfaces an errored assistant message in the timeline", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 5,
      event: {
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          errorMessage: "404 status code (no body)",
        },
      },
    });
    const st = useExecutionStore.getState();
    expect(st.transcripts["a"]).toEqual([
      { role: "system", text: "⚠ 404 status code (no body)", ts: 5 },
    ]);
  });

  it("keeps the spinner alive and notes an auto-retry", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 6,
      event: {
        type: "auto_retry_start",
        attempt: 1,
        maxAttempts: 3,
        errorMessage: "connection lost",
      },
    });
    const st = useExecutionStore.getState();
    expect(st.streaming["a"]).toBe(true);
    expect(st.waiting["a"]).toBe(false);
    expect(st.transcripts["a"][0].text).toContain("正在自动重试（第 1/3 次）");
  });

  it("stops the run and surfaces the reason when retries are exhausted", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 7,
      event: {
        type: "auto_retry_end",
        success: false,
        finalError: "Retry cancelled",
      },
    });
    const st = useExecutionStore.getState();
    expect(st.streaming["a"]).toBe(false);
    expect(st.waiting["a"]).toBe(true);
    expect(st.transcripts["a"]).toEqual([
      { role: "system", text: "✖ Retry cancelled", ts: 7 },
    ]);
  });

  it("startNewRun keeps prior history with a divider; resetRun clears it", () => {
    const s = useExecutionStore.getState();
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 1,
      event: { type: "agent_start" },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 2,
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "旧输出" }] },
      },
    });
    s.appendAgentEvent({
      runId: "r1",
      todoId: "a",
      ts: 3,
      event: { type: "agent_end", messages: [] },
    });
    expect(useExecutionStore.getState().transcripts["a"]).toHaveLength(1);

    s.startNewRun("a");
    const kept = useExecutionStore.getState().transcripts["a"];
    expect(kept).toHaveLength(2);
    expect(kept[0].text).toBe("旧输出");
    expect(kept[1]).toMatchObject({ role: "system", text: "重新执行" });
    expect(useExecutionStore.getState().streaming["a"]).toBe(false);

    s.resetRun("a");
    expect(useExecutionStore.getState().transcripts["a"]).toEqual([]);
  });

  it("hydrateTranscripts replaces the transcript map", () => {
    const s = useExecutionStore.getState();
    s.hydrateTranscripts({
      b: [{ role: "assistant", text: "恢复的历史", ts: 9 }],
    });
    expect(useExecutionStore.getState().transcripts["b"]).toEqual([
      { role: "assistant", text: "恢复的历史", ts: 9 },
    ]);
  });
});

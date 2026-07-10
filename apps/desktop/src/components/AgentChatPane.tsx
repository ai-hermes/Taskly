import { useEffect, useMemo, useRef, useState } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { useExecutionStore, useTodoStore } from "@/store";
import {
  startInteractiveRun,
  replyToAgent,
  answerUiRequest,
  abortTurn,
  finishRun,
  cancelRun,
  validateReadyToExecute,
} from "@/services/agent";
import { WorkspacePrepareModal } from "./WorkspacePrepareModal";
import { Markdown } from "./Markdown";
import type {
  ExecLogEvent,
  AgentUiRequestBody,
  TranscriptEntry,
  TodoItem,
} from "@/types";
import {
  ArrowsClockwise,
  ChatsCircle,
  CheckCircle,
  CircleNotch,
  FileText,
  FolderOpen,
  PaperPlaneRight,
  Play,
  Prohibit,
  Stop,
  Terminal,
  Toolbox,
  Warning,
  Wrench,
  XCircle,
} from "@phosphor-icons/react";

const EMPTY_LOGS: ExecLogEvent[] = [];
const EMPTY_TRANSCRIPT: TranscriptEntry[] = [];

const ROLE_LABELS: Record<TranscriptEntry["role"], string> = {
  user: "你",
  assistant: "Agent",
  system: "系统",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "未开始",
  workspace_ready: "工作区就绪",
  running: "执行中",
  waiting_input: "等待你的回复",
  validating: "校验中",
  succeeded: "执行成功",
  failed: "执行失败",
};

export function AgentChatPane() {
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const todo = useTodoStore((s) =>
    activeTodoId ? s.todos.find((t) => t.id === activeTodoId) : undefined
  );

  if (!activeTodoId || !todo) {
    return (
      <div className="agent-chat-pane empty">
        <div className="chat-empty-state">
          <ChatsCircle size={40} weight="duotone" />
          <h3>Agent 会话</h3>
          <p>
            在左侧选择一个待办即可查看或开始 Agent 执行会话。
            <br />
            执行过程支持多轮对话：Agent 提问时你可以直接回复。
          </p>
        </div>
      </div>
    );
  }

  return <ChatSession key={todo.id} todo={todo} />;
}

function ChatSession({ todo }: { todo: TodoItem }) {
  const todoId = todo.id;
  const logs = useExecutionStore((s) => s.logs[todoId] ?? EMPTY_LOGS);
  const transcript = useExecutionStore(
    (s) => s.transcripts[todoId] ?? EMPTY_TRANSCRIPT
  );
  const stream = useExecutionStore((s) => s.streams[todoId] ?? "");
  const uiRequest = useExecutionStore((s) => s.uiRequests[todoId] ?? null);
  const streaming = useExecutionStore((s) => s.streaming[todoId] ?? false);
  const waiting = useExecutionStore((s) => s.waiting[todoId] ?? false);

  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const execution = todo.execution;
  const status = execution?.status ?? "idle";
  const isLive =
    status === "running" || status === "waiting_input" || status === "validating";
  const notReady = useMemo(
    () => validateReadyToExecute(todoId),
    // Re-evaluate when workspace changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todoId, todo.workspace]
  );

  useEffect(() => {
    const el = timelineRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, stream, uiRequest, execution?.validationResults]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, showLogs]);

  const guarded = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // Errors are reflected in the store.
    } finally {
      setBusy(false);
    }
  };

  const sendReply = () => {
    const text = reply.trim();
    if (!text) return;
    setReply("");
    void guarded(() => replyToAgent(todoId, text));
  };

  const onStart = () => guarded(() => startInteractiveRun(todoId));
  const onFinish = () => guarded(() => finishRun(todoId));
  const onAbort = () => guarded(() => abortTurn(todoId));
  const onCancel = () => guarded(() => cancelRun(todoId));

  const answer = (payload: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => {
    if (!uiRequest) return;
    void guarded(() => answerUiRequest(todoId, uiRequest.id, payload));
  };

  const openLog = () => {
    if (execution?.logFilePath) void openPath(execution.logFilePath);
  };
  const openWorkspace = () => {
    if (todo.workspace?.workspacePath)
      void revealItemInDir(todo.workspace.workspacePath);
  };

  const hasTimeline = transcript.length > 0 || !!stream;

  return (
    <div className="agent-chat-pane">
      <div className="chat-pane-header">
        <div className="chat-pane-heading">
          <h2 title={todo.title}>{todo.title}</h2>
          <div className="chat-pane-meta">
            <span className={`exec-badge ${status}`}>
              {isLive && <CircleNotch size={11} className="spin" />}
              {STATUS_LABELS[status] ?? status}
            </span>
            {execution?.runId && <span className="run-id">{execution.runId}</span>}
          </div>
        </div>
        <div className="chat-pane-tools">
          <button
            type="button"
            className="btn-icon"
            onClick={() => setPreparing(true)}
            title="准备工作区"
            aria-label="准备工作区"
          >
            <Toolbox size={16} />
          </button>
          {todo.workspace && (
            <button
              type="button"
              className="btn-icon"
              onClick={openWorkspace}
              title="打开工作区目录"
              aria-label="打开工作区目录"
            >
              <FolderOpen size={16} />
            </button>
          )}
          {execution?.logFilePath && (
            <button
              type="button"
              className="btn-icon"
              onClick={openLog}
              title="打开日志文件"
              aria-label="打开日志文件"
            >
              <FileText size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="chat-timeline" ref={timelineRef}>
        {!hasTimeline && (
          <div className="chat-timeline-empty">
            {isLive ? (
              <p>等待 Agent 输出…</p>
            ) : status === "idle" || status === "workspace_ready" ? (
              <p>
                点击下方「开始执行」，Agent 将在工作区内执行该待办。
                {notReady && (
                  <span className="chat-hint-warning">
                    <Warning size={13} weight="fill" /> {notReady}
                  </span>
                )}
              </p>
            ) : (
              <p>{execution?.summary || "暂无对话记录"}</p>
            )}
          </div>
        )}

        {transcript.map((m, i) =>
          m.kind === "tool" ? (
            <div key={i} className="chat-tool-entry">
              <Wrench size={13} />
              <span>调用工具</span>
              <code>{m.toolName ?? m.text}</code>
            </div>
          ) : (
            <div key={i} className={`chat-bubble ${m.role}`}>
              <span className="chat-role">{ROLE_LABELS[m.role]}</span>
              {m.role === "assistant" ? (
                <Markdown text={m.text} />
              ) : (
                <div className="chat-text">{m.text}</div>
              )}
            </div>
          )
        )}

        {stream && (
          <div className="chat-bubble assistant streaming">
            <span className="chat-role">
              {ROLE_LABELS.assistant}
              {streaming && <CircleNotch size={11} className="spin" />}
            </span>
            <Markdown text={stream} />
          </div>
        )}

        {isLive && uiRequest && (
          <UiRequestCard request={uiRequest} disabled={busy} onAnswer={answer} />
        )}

        {execution?.validationResults && execution.validationResults.length > 0 && (
          <div className="validation-list chat-card">
            <h4>校验结果</h4>
            {execution.validationResults.map((v, i) => (
              <details key={i} className={`validation-item ${v.ok ? "ok" : "fail"}`}>
                <summary>
                  {v.ok ? (
                    <CheckCircle size={13} weight="fill" />
                  ) : (
                    <XCircle size={13} weight="fill" />
                  )}
                  <code>{v.command}</code>
                  <span>
                    exit {v.exitCode} · {(v.durationMs / 1000).toFixed(1)}s
                  </span>
                </summary>
                {v.stdoutTail && (
                  <>
                    <span className="validation-stream-label">stdout</span>
                    <pre>{v.stdoutTail}</pre>
                  </>
                )}
                {v.stderrTail && (
                  <>
                    <span className="validation-stream-label">stderr</span>
                    <pre className="stderr">{v.stderrTail}</pre>
                  </>
                )}
              </details>
            ))}
          </div>
        )}

        {status === "failed" && execution?.error && (
          <p className="execution-error chat-card">
            <Warning size={14} weight="fill" />
            {execution.error}
          </p>
        )}

        {status === "succeeded" && execution?.summary && (
          <p className="execution-success chat-card">
            <CheckCircle size={14} weight="fill" />
            {execution.summary}
          </p>
        )}
      </div>

      <div className="chat-dock">
        {isLive && !uiRequest && (
          <div className="chat-composer">
            {waiting && (
              <div className="composer-hint">
                <CheckCircle size={13} weight="fill" /> Agent 正在等待你的回复
              </div>
            )}
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply();
              }}
              placeholder={
                waiting
                  ? "回复 Agent，或直接点「完成并校验」…（⌘/Ctrl+Enter 发送）"
                  : "Agent 正在处理，可继续补充说明…"
              }
              rows={2}
            />
            <div className="composer-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={sendReply}
                disabled={busy || !reply.trim()}
              >
                <PaperPlaneRight size={14} />
                发送
              </button>
              {streaming && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={onAbort}
                  disabled={busy}
                  title="打断当前回合，但保留会话"
                >
                  <Stop size={14} />
                  打断
                </button>
              )}
              <button
                type="button"
                className="btn-secondary danger"
                onClick={onCancel}
                disabled={busy}
                title="放弃本次执行"
              >
                <Prohibit size={14} />
                放弃
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={onFinish}
                disabled={busy}
                title="结束会话并运行校验链"
              >
                <CheckCircle size={14} />
                完成并校验
              </button>
            </div>
          </div>
        )}

        {!isLive && (
          <div className="chat-composer idle">
            <div className="composer-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={onStart}
                disabled={busy || notReady !== null}
                title={notReady ?? undefined}
              >
                {status === "failed" || status === "succeeded" ? (
                  <>
                    <ArrowsClockwise size={14} />
                    重新执行
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    开始执行
                  </>
                )}
              </button>
              {notReady && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPreparing(true)}
                >
                  <Toolbox size={14} />
                  准备工作区
                </button>
              )}
            </div>
          </div>
        )}

        <button
          type="button"
          className="log-toggle"
          onClick={() => setShowLogs((v) => !v)}
        >
          <Terminal size={13} />
          {showLogs ? "隐藏原始日志" : "原始日志"} ({logs.length})
        </button>
        {showLogs && (
          <div className="log-view chat-log-dock" ref={logRef}>
            {logs.length === 0 ? (
              <p className="log-empty">暂无日志</p>
            ) : (
              logs.map((l, i) => (
                <div key={i} className={`log-line ${l.stream}`}>
                  {l.line}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {preparing && (
        <WorkspacePrepareModal todo={todo} onClose={() => setPreparing(false)} />
      )}
    </div>
  );
}

/** Renders an agent extension UI request as an inline timeline card. */
function UiRequestCard({
  request,
  disabled,
  onAnswer,
}: {
  request: AgentUiRequestBody;
  disabled: boolean;
  onAnswer: (payload: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
}) {
  const [text, setText] = useState(request.prefill ?? "");
  const title = request.title || request.message || "Agent 需要你的输入";

  return (
    <div className="ui-request chat-card">
      <div className="ui-request-title">
        <Warning size={14} weight="fill" />
        {title}
      </div>
      {request.method === "select" && (
        <div className="ui-request-options">
          {(request.options ?? []).map((opt, i) => (
            <button
              key={i}
              type="button"
              className="btn-secondary"
              disabled={disabled}
              onClick={() => onAnswer({ value: opt })}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {request.method === "confirm" && (
        <div className="ui-request-options">
          <button
            type="button"
            className="btn-primary"
            disabled={disabled}
            onClick={() => onAnswer({ confirmed: true })}
          >
            确认
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => onAnswer({ confirmed: false })}
          >
            否
          </button>
        </div>
      )}
      {(request.method === "input" || request.method === "editor") && (
        <div className="ui-request-input">
          {request.method === "editor" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              rows={3}
            />
          ) : (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAnswer({ value: text });
              }}
            />
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={disabled}
            onClick={() => onAnswer({ value: text })}
          >
            <PaperPlaneRight size={14} />
            提交
          </button>
        </div>
      )}
      <button
        type="button"
        className="ui-request-cancel"
        disabled={disabled}
        onClick={() => onAnswer({ cancelled: true })}
      >
        取消
      </button>
    </div>
  );
}

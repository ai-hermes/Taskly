import { useEffect, useMemo, useRef, useState } from "react";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
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
  ToolCallEntry,
} from "@/types";
import {
  ArrowsClockwise,
  CaretRight,
  ChatsCircle,
  ChatCircleDots,
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
const EMPTY_TOOLS: Record<string, ToolCallEntry> = {};

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
  const liveThinking = useExecutionStore((s) => s.thinking[todoId] ?? "");
  const toolCalls = useExecutionStore((s) => s.toolCalls[todoId] ?? EMPTY_TOOLS);
  const uiRequest = useExecutionStore((s) => s.uiRequests[todoId] ?? null);
  const streaming = useExecutionStore((s) => s.streaming[todoId] ?? false);
  const waiting = useExecutionStore((s) => s.waiting[todoId] ?? false);
  const awaitingReply = useExecutionStore((s) => s.awaitingReply[todoId] ?? false);

  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [showLogs, setShowLogs] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const execution = todo.execution;
  const status = execution?.status ?? "idle";
  const actionable = (todo.todoKind ?? "actionable") !== "notification";
  const isPending = todo.reviewStatus === "pending_confirmation";
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
  }, [transcript, stream, liveThinking, toolCalls, uiRequest, execution?.validationResults]);

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

  // Distinguish a genuine human-in-the-loop pause (the agent asked something, or
  // raised a structured UI request) from a turn that simply finished. Both used
  // to read as "等待你的回复", which made "done" indistinguishable from "blocked".
  const turnComplete = waiting && !streaming && !uiRequest && !awaitingReply;
  const statusLabel =
    status === "waiting_input" && turnComplete
      ? "本轮完成"
      : STATUS_LABELS[status] ?? status;

  return (
    <div className={`agent-chat-pane${isPending ? " pending" : ""}`}>
      <div className="chat-pane-header">
        <div className="chat-pane-heading">
          <h2 title={todo.title}>{todo.title}</h2>
          <div className="chat-pane-meta">
            <span className={`exec-badge ${status}${turnComplete ? " turn-complete" : ""}`}>
              {streaming && <CircleNotch size={11} className="spin" />}
              {statusLabel}
            </span>
            {execution?.runId && <span className="run-id">{execution.runId}</span>}
          </div>
        </div>
        {!isPending && (
        <div className="chat-pane-tools">
          {actionable && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => setPreparing(true)}
              title="准备工作区"
              aria-label="准备工作区"
            >
              <Toolbox size={16} />
            </button>
          )}
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
          <button
            type="button"
            className={`btn-icon${showLogs ? " active" : ""}`}
            onClick={() => setShowLogs((v) => !v)}
            title={showLogs ? "隐藏原始日志" : "原始日志"}
            aria-label="原始日志"
          >
            <Terminal size={16} />
          </button>
        </div>
        )}
      </div>
      <SourceEvidenceCard todo={todo} />

      {!isPending && (
        <>
      <div className="chat-timeline" ref={timelineRef}>
        {!hasTimeline && (
          <div className="chat-timeline-empty">
            {isLive ? (
              <p>等待 Agent 输出…</p>
            ) : !actionable ? (
              <p>该事项被归类为仅通知，已隐藏执行入口。</p>
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
            <ToolCard
              key={i}
              entry={m.toolCallId ? toolCalls[m.toolCallId] : undefined}
              fallbackName={m.toolName ?? m.text}
            />
          ) : m.kind === "thinking" ? (
            <ThinkingBlock key={i} text={m.text} />
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

        {liveThinking && <ThinkingBlock text={liveThinking} live />}

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

        {showLogs && (
          <div className="log-view" ref={logRef}>
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

      <div className="chat-dock">
        {isLive && !uiRequest && (
          <div className="chat-composer">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendReply();
              }}
              placeholder={
                waiting && awaitingReply
                  ? "回复 Agent…（⌘/Ctrl+Enter 发送）"
                  : turnComplete
                    ? "可继续对话补充，或点击「完成并校验」结束…"
                    : "Agent 正在处理，可继续补充说明…"
              }
              rows={3}
            />
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                {waiting && awaitingReply ? (
                  <span className="composer-status awaiting">
                    <ChatCircleDots size={13} weight="fill" />
                    Agent 有一个问题，等待你的回复
                  </span>
                ) : turnComplete ? (
                  <span className="composer-status done">
                    <CheckCircle size={13} weight="fill" />
                    本轮已完成 · 可继续补充或点「完成并校验」结束
                  </span>
                ) : (
                  <span className="composer-status">
                    <CircleNotch size={12} className="spin" />
                    Agent 正在处理…
                  </span>
                )}
              </div>
              <div className="composer-toolbar-right">
                <button
                  type="button"
                  className="composer-btn"
                  onClick={sendReply}
                  disabled={busy || !reply.trim()}
                  data-tip="发送 · ⌘/Ctrl+Enter"
                  aria-label="发送"
                >
                  <PaperPlaneRight size={16} />
                </button>
                {streaming && (
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={onAbort}
                    disabled={busy}
                    data-tip="打断当前回合"
                    aria-label="打断"
                  >
                    <Stop size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="composer-btn danger"
                  onClick={onCancel}
                  disabled={busy}
                  data-tip="放弃本次执行"
                  aria-label="放弃"
                >
                  <Prohibit size={16} />
                </button>
                <button
                  type="button"
                  className="composer-btn primary"
                  onClick={onFinish}
                  disabled={busy}
                  data-tip="完成并校验"
                  aria-label="完成并校验"
                >
                  <CheckCircle size={16} weight="fill" />
                </button>
              </div>
            </div>
          </div>
        )}

        {!isLive && !isPending && (
          <div className="chat-composer idle">
            {actionable ? (
              <div className="composer-actions">
                {notReady && (
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={() => setPreparing(true)}
                    data-tip="准备工作区"
                    aria-label="准备工作区"
                  >
                    <Toolbox size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="composer-btn primary"
                  onClick={onStart}
                  disabled={busy || notReady !== null}
                  data-tip={
                    notReady ??
                    (status === "failed" || status === "succeeded"
                      ? "重新执行"
                      : "开始执行")
                  }
                  aria-label={
                    status === "failed" || status === "succeeded"
                      ? "重新执行"
                      : "开始执行"
                  }
                >
                  {status === "failed" || status === "succeeded" ? (
                    <ArrowsClockwise size={16} />
                  ) : (
                    <Play size={16} weight="fill" />
                  )}
                </button>
              </div>
            ) : (
              <div className="chat-hint-notification">仅通知事项，不支持执行。</div>
            )}
          </div>
        )}

      </div>
        </>
      )}

      {preparing && (
        <WorkspacePrepareModal todo={todo} onClose={() => setPreparing(false)} />
      )}
    </div>
  );
}

function SourceEvidenceCard({ todo }: { todo: TodoItem }) {
  const evidence = todo.sourceEvidence;
  const screenshotPath = evidence?.screenshotPath;
  const matched = evidence?.matchedRegions ?? [];
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [imageError, setImageError] = useState(false);

  if (!screenshotPath) return null;
  const imageSrc = convertFileSrc(screenshotPath);
  const bounds = matched
    .map((region) => boxToBounds(region.box, imageSize.width, imageSize.height))
    .filter((b): b is Bounds => b !== null);
  const spotlight = !imageError && bounds.length > 0;

  return (
    <div className="chat-source-card open">
      <div className="chat-source-summary">
        来源截图
        <span>{matched.length > 0 ? `已定位 ${matched.length} 处来源` : "未定位到高亮区域"}</span>
      </div>
      <div className="chat-source-body">
        {!imageError ? (
          <div className={`chat-source-image${spotlight ? " spotlight" : ""}`}>
            <img
              src={imageSrc}
              alt="todo 来源截图"
              onLoad={(e) => {
                const image = e.currentTarget;
                setImageSize({
                  width: image.naturalWidth || 1,
                  height: image.naturalHeight || 1,
                });
              }}
              onError={() => setImageError(true)}
            />
            {spotlight && (
              <svg
                className="chat-source-mask"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <mask id={`source-mask-${todo.id}`}>
                    <rect x="0" y="0" width="100" height="100" fill="white" />
                    {bounds.map((b, i) => (
                      <rect
                        key={`dim-${i}`}
                        x={b.x * 100}
                        y={b.y * 100}
                        width={b.w * 100}
                        height={b.h * 100}
                        rx="1"
                        fill="black"
                      />
                    ))}
                  </mask>
                </defs>
                <rect
                  x="0"
                  y="0"
                  width="100"
                  height="100"
                  fill="rgba(0,0,0,0.5)"
                  mask={`url(#source-mask-${todo.id})`}
                />
              </svg>
            )}
            {bounds.map((b, index) => (
              <span
                key={`${index}-${matched[index]?.text ?? ""}`}
                className="chat-source-highlight"
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.w * 100}%`,
                  height: `${b.h * 100}%`,
                }}
                title={matched[index]?.text}
              />
            ))}
          </div>
        ) : (
          <p className="chat-source-fallback">截图文件不可读取：{screenshotPath}</p>
        )}
        {todo.sourceText && <pre className="chat-source-text">{todo.sourceText}</pre>}
      </div>
    </div>
  );
}

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalize an OCR polygon box to a clamped [0,1] rect, or null if invalid. */
function boxToBounds(points: number[][], width: number, height: number): Bounds | null {
  if (!points || points.length === 0 || width <= 0 || height <= 0) return null;
  const xs = points.map((p) => p?.[0]).filter((n): n is number => typeof n === "number");
  const ys = points.map((p) => p?.[1]).filter((n): n is number => typeof n === "number");
  if (xs.length === 0 || ys.length === 0) return null;
  const left = Math.max(0, Math.min(...xs));
  const right = Math.min(width, Math.max(...xs));
  const top = Math.max(0, Math.min(...ys));
  const bottom = Math.min(height, Math.max(...ys));
  if (right <= left || bottom <= top) return null;
  return {
    x: left / width,
    y: top / height,
    w: (right - left) / width,
    h: (bottom - top) / height,
  };
}

/** Collapsible thinking block (craft-style reasoning disclosure). */
function ThinkingBlock({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`chat-thinking${live ? " live" : ""}`}>
      <button
        type="button"
        className="chat-thinking-head"
        onClick={() => setOpen((v) => !v)}
      >
        <CaretRight size={12} className={`chat-caret${open ? " open" : ""}`} />
        <span>{live ? "正在思考" : "思考过程"}</span>
        {live && <CircleNotch size={11} className="spin" />}
      </button>
      {open && <div className="chat-thinking-body">{text}</div>}
    </div>
  );
}

/** Collapsible tool-call card: name + args summary + streamed/final output. */
/**
 * Condense a tool argument summary for the collapsed card head so the useful
 * part stays visible: collapse the home dir to `~`, and shorten long paths to
 * their last two segments (…/parent/file) so the filename isn't cut off by the
 * trailing ellipsis. Works per whitespace token so paths embedded in a bash
 * command are shortened too. The full value still shows when expanded.
 */
function shortenToolToken(tok: string): string {
  let t = tok.replace(/^\/(?:Users|home)\/[^/]+\//, "~/");
  if (t.includes("/") && t.length > 40) {
    const hadTrailing = /\/$/.test(t);
    const segs = t.split("/").filter(Boolean);
    if (segs.length > 2) {
      t = "…/" + segs.slice(-2).join("/") + (hadTrailing ? "/" : "");
    }
  }
  return t;
}

function shortenToolSummary(s: string): string {
  if (!s) return "";
  if (!/\s/.test(s)) return shortenToolToken(s);
  return s
    .split(/(\s+)/)
    .map((p) => (/^\s+$/.test(p) ? p : shortenToolToken(p)))
    .join("");
}

function ToolCard({
  entry,
  fallbackName,
}: {
  entry?: ToolCallEntry;
  fallbackName: string;
}) {
  const [open, setOpen] = useState(false);
  const name = entry?.name ?? fallbackName;
  const status = entry?.status ?? "ok";
  const summary = entry?.argsSummary ?? "";
  const headSummary = shortenToolSummary(summary);
  const output = entry?.output ?? "";
  const hasBody = !!(summary || output);

  return (
    <div className={`chat-tool-card ${status}`}>
      <button
        type="button"
        className="chat-tool-head"
        onClick={() => hasBody && setOpen((v) => !v)}
        disabled={!hasBody}
      >
        {hasBody && (
          <CaretRight size={12} className={`chat-caret${open ? " open" : ""}`} />
        )}
        <Wrench size={13} />
        <code className="chat-tool-name">{name}</code>
        {headSummary && (
          <span className="chat-tool-summary" title={summary}>
            {headSummary}
          </span>
        )}
        <span className="chat-tool-status">
          {status === "running" ? (
            <CircleNotch size={12} className="spin" />
          ) : status === "error" ? (
            <XCircle size={13} weight="fill" />
          ) : (
            <CheckCircle size={13} weight="fill" />
          )}
        </span>
      </button>
      {open && hasBody && (
        <div className="chat-tool-body">
          {summary && <pre className="chat-tool-args">{summary}</pre>}
          {output && <pre className="chat-tool-output">{output}</pre>}
        </div>
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

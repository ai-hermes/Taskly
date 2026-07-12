import {
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type WheelEvent as ReactWheelEvent,
  type ReactNode,
} from "react";
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
  BanIcon,
  BotMessageSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  FileTextIcon,
  FolderOpenIcon,
  MessageCircleQuestionIcon,
  PlayIcon,
  RefreshCwIcon,
  SendIcon,
  SquareTerminalIcon,
  StopCircleIcon,
  ToolboxIcon,
  TriangleAlertIcon,
  WrenchIcon,
  XCircleIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const EMPTY_LOGS: ExecLogEvent[] = [];
const EMPTY_TRANSCRIPT: TranscriptEntry[] = [];
const EMPTY_TOOLS: Record<string, ToolCallEntry> = {};
const SOURCE_ZOOM_MIN = 1;
const SOURCE_ZOOM_MAX = 3;
const SOURCE_ZOOM_STEP = 0.25;

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

function ChatIconButton({
  children,
  disabled,
  label,
  onClick,
  variant = "ghost",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant={variant}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AgentChatPane() {
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const todo = useTodoStore((s) =>
    activeTodoId ? s.todos.find((t) => t.id === activeTodoId) : undefined
  );

  if (!activeTodoId || !todo) {
    return (
      <div className="agent-chat-pane empty">
        <Empty className="chat-empty-state">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BotMessageSquareIcon />
            </EmptyMedia>
            <EmptyTitle>Agent 会话</EmptyTitle>
            <EmptyDescription>
              在左侧选择一个待办即可查看或开始 Agent 执行会话。执行过程支持多轮对话：Agent 提问时你可以直接回复。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
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
            <Badge
              className={`exec-badge ${status}${turnComplete ? " turn-complete" : ""}`}
              variant={status === "failed" ? "destructive" : "secondary"}
            >
              {streaming && <Spinner data-icon="inline-start" />}
              {statusLabel}
            </Badge>
            {execution?.runId && <Badge variant="outline">{execution.runId}</Badge>}
          </div>
        </div>
        {!isPending && (
          <div className="chat-pane-tools">
            {actionable && (
              <ChatIconButton
                label="准备工作区"
                onClick={() => setPreparing(true)}
              >
                <ToolboxIcon />
              </ChatIconButton>
            )}
            {todo.workspace && (
              <ChatIconButton label="打开工作区目录" onClick={openWorkspace}>
                <FolderOpenIcon />
              </ChatIconButton>
            )}
            {execution?.logFilePath && (
              <ChatIconButton label="打开日志文件" onClick={openLog}>
                <FileTextIcon />
              </ChatIconButton>
            )}
            <ChatIconButton
              label={showLogs ? "隐藏原始日志" : "原始日志"}
              onClick={() => setShowLogs((v) => !v)}
              variant={showLogs ? "secondary" : "ghost"}
            >
              <SquareTerminalIcon />
            </ChatIconButton>
          </div>
        )}
      </div>
      <SourceEvidenceCard todo={todo} />

      {!isPending && (
        <>
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="chat-timeline">
              <MessageScrollerViewport>
                <MessageScrollerContent>
                  {!hasTimeline && (
                    <MessageScrollerItem messageId="empty">
                      <Empty className="chat-timeline-empty">
                        <EmptyHeader>
                          <EmptyTitle>
                            {isLive
                              ? "等待 Agent 输出…"
                              : !actionable
                                ? "仅通知事项"
                                : status === "idle" || status === "workspace_ready"
                                  ? "可以开始执行"
                                  : "暂无对话记录"}
                          </EmptyTitle>
                          <EmptyDescription>
                            {isLive
                              ? "Agent 正在准备输出。"
                              : !actionable
                                ? "该事项被归类为仅通知，已隐藏执行入口。"
                                : status === "idle" || status === "workspace_ready"
                                  ? "点击下方「开始执行」，Agent 将在工作区内执行该待办。"
                                  : execution?.summary || "暂无对话记录"}
                          </EmptyDescription>
                        </EmptyHeader>
                      </Empty>
                      {notReady && (
                        <Alert variant="destructive" className="chat-hint-warning">
                          <TriangleAlertIcon />
                          <AlertDescription>{notReady}</AlertDescription>
                        </Alert>
                      )}
                    </MessageScrollerItem>
                  )}

                  {transcript.map((message, index) => (
                    <MessageScrollerItem
                      key={`${message.role}-${message.kind}-${index}`}
                      messageId={`${todoId}-${index}`}
                      scrollAnchor={message.role === "user"}
                    >
                      {message.kind === "tool" ? (
                        <ToolCard
                          entry={
                            message.toolCallId
                              ? toolCalls[message.toolCallId]
                              : undefined
                          }
                          fallbackName={message.toolName ?? message.text}
                        />
                      ) : message.kind === "thinking" ? (
                        <ThinkingBlock text={message.text} />
                      ) : (
                        <Message
                          align={message.role === "user" ? "end" : "start"}
                        >
                          <MessageContent>
                            <MessageHeader>
                              {ROLE_LABELS[message.role]}
                            </MessageHeader>
                            <Bubble
                              align={message.role === "user" ? "end" : "start"}
                              variant={
                                message.role === "user"
                                  ? "default"
                                  : message.role === "system"
                                    ? "outline"
                                    : "secondary"
                              }
                            >
                              <BubbleContent>
                                {message.role === "assistant" ? (
                                  <Markdown text={message.text} />
                                ) : (
                                  <div className="chat-text">{message.text}</div>
                                )}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      )}
                    </MessageScrollerItem>
                  ))}

                  {liveThinking && (
                    <MessageScrollerItem messageId={`${todoId}-thinking`}>
                      <ThinkingBlock text={liveThinking} live />
                    </MessageScrollerItem>
                  )}

                  {stream && (
                    <MessageScrollerItem messageId={`${todoId}-stream`}>
                      <Message align="start">
                        <MessageContent>
                          <MessageHeader>
                            {ROLE_LABELS.assistant}
                            {streaming && <Spinner data-icon="inline-end" />}
                          </MessageHeader>
                          <Bubble variant="secondary">
                            <BubbleContent>
                              <Markdown text={stream} />
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  )}

                  {isLive && uiRequest && (
                    <MessageScrollerItem messageId={`${todoId}-ui-request`}>
                      <UiRequestCard
                        request={uiRequest}
                        disabled={busy}
                        onAnswer={answer}
                      />
                    </MessageScrollerItem>
                  )}

                  {execution?.validationResults &&
                    execution.validationResults.length > 0 && (
                      <MessageScrollerItem messageId={`${todoId}-validation`}>
                        <Card className="validation-list chat-card">
                          <CardHeader>
                            <CardTitle>校验结果</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <Accordion type="multiple">
                              {execution.validationResults.map((result, index) => (
                                <AccordionItem
                                  key={`${result.command}-${index}`}
                                  value={`validation-${index}`}
                                >
                                  <AccordionTrigger>
                                    <span className="flex min-w-0 items-center gap-2">
                                      {result.ok ? (
                                        <CheckCircleIcon />
                                      ) : (
                                        <XCircleIcon />
                                      )}
                                      <code>{result.command}</code>
                                      <Badge
                                        variant={
                                          result.ok ? "secondary" : "destructive"
                                        }
                                      >
                                        exit {result.exitCode} ·{" "}
                                        {(result.durationMs / 1000).toFixed(1)}s
                                      </Badge>
                                    </span>
                                  </AccordionTrigger>
                                  <AccordionContent>
                                    {result.stdoutTail && (
                                      <>
                                        <span className="validation-stream-label">
                                          stdout
                                        </span>
                                        <pre>{result.stdoutTail}</pre>
                                      </>
                                    )}
                                    {result.stderrTail && (
                                      <>
                                        <span className="validation-stream-label">
                                          stderr
                                        </span>
                                        <pre className="stderr">
                                          {result.stderrTail}
                                        </pre>
                                      </>
                                    )}
                                  </AccordionContent>
                                </AccordionItem>
                              ))}
                            </Accordion>
                          </CardContent>
                        </Card>
                      </MessageScrollerItem>
                    )}

                  {status === "failed" && execution?.error && (
                    <MessageScrollerItem messageId={`${todoId}-error`}>
                      <Alert variant="destructive" className="execution-error chat-card">
                        <TriangleAlertIcon />
                        <AlertDescription>{execution.error}</AlertDescription>
                      </Alert>
                    </MessageScrollerItem>
                  )}

                  {status === "succeeded" && execution?.summary && (
                    <MessageScrollerItem messageId={`${todoId}-success`}>
                      <Alert className="execution-success chat-card">
                        <CheckCircleIcon />
                        <AlertDescription>{execution.summary}</AlertDescription>
                      </Alert>
                    </MessageScrollerItem>
                  )}

                  {showLogs && (
                    <MessageScrollerItem messageId={`${todoId}-logs`}>
                      <Card>
                        <CardHeader>
                          <CardTitle>原始日志</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="log-view">
                            {logs.length === 0 ? (
                              <Empty className="log-empty">
                                <EmptyHeader>
                                  <EmptyTitle>暂无日志</EmptyTitle>
                                </EmptyHeader>
                              </Empty>
                            ) : (
                              logs.map((log, index) => (
                                <div
                                  key={`${index}-${log.stream}`}
                                  className={`log-line ${log.stream}`}
                                >
                                  {log.line}
                                </div>
                              ))
                            )}
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </MessageScrollerItem>
                  )}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>

      <div className="chat-dock">
        {isLive && !uiRequest && (
          <div className="chat-composer">
            <InputGroup>
              <InputGroupTextarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
                    sendReply();
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
            </InputGroup>
            <div className="composer-toolbar">
              <div className="composer-toolbar-left">
                {waiting && awaitingReply ? (
                  <Marker className="composer-status awaiting">
                    <MarkerIcon>
                      <MessageCircleQuestionIcon />
                    </MarkerIcon>
                    <MarkerContent>Agent 有一个问题，等待你的回复</MarkerContent>
                  </Marker>
                ) : turnComplete ? (
                  <Marker className="composer-status done">
                    <MarkerIcon>
                      <CheckCircleIcon />
                    </MarkerIcon>
                    <MarkerContent>
                      本轮已完成 · 可继续补充或点「完成并校验」结束
                    </MarkerContent>
                  </Marker>
                ) : (
                  <Marker className="composer-status">
                    <MarkerIcon>
                      <Spinner />
                    </MarkerIcon>
                    <MarkerContent>Agent 正在处理…</MarkerContent>
                  </Marker>
                )}
              </div>
              <div className="composer-toolbar-right">
                <ChatIconButton
                  onClick={sendReply}
                  disabled={busy || !reply.trim()}
                  label="发送 · ⌘/Ctrl+Enter"
                >
                  <SendIcon />
                </ChatIconButton>
                {streaming && (
                  <ChatIconButton
                    onClick={onAbort}
                    disabled={busy}
                    label="打断当前回合"
                  >
                    <StopCircleIcon />
                  </ChatIconButton>
                )}
                <ChatIconButton
                  onClick={onCancel}
                  disabled={busy}
                  label="放弃本次执行"
                  variant="destructive"
                >
                  <BanIcon />
                </ChatIconButton>
                <ChatIconButton
                  onClick={onFinish}
                  disabled={busy}
                  label="完成并校验"
                  variant="default"
                >
                  <CheckCircleIcon />
                </ChatIconButton>
              </div>
            </div>
          </div>
        )}

        {!isLive && !isPending && (
          <div className="chat-composer idle">
            {actionable ? (
              <div className="composer-actions">
                {notReady && (
                  <ChatIconButton
                    onClick={() => setPreparing(true)}
                    label="准备工作区"
                  >
                    <ToolboxIcon />
                  </ChatIconButton>
                )}
                <ChatIconButton
                  onClick={onStart}
                  disabled={busy || notReady !== null}
                  label={
                    notReady ??
                    (status === "failed" || status === "succeeded"
                      ? "重新执行"
                      : "开始执行")
                  }
                  variant="default"
                >
                  {status === "failed" || status === "succeeded" ? (
                    <RefreshCwIcon />
                  ) : (
                    <PlayIcon />
                  )}
                </ChatIconButton>
              </div>
            ) : (
              <Alert className="chat-hint-notification">
                <AlertDescription>仅通知事项，不支持执行。</AlertDescription>
              </Alert>
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
  const [sourceZoom, setSourceZoom] = useState(1);
  const sourceDialogBodyRef = useRef<HTMLDivElement>(null);

  if (!screenshotPath) return null;
  const imageSrc = convertFileSrc(screenshotPath);
  const bounds = matched
    .map((region) => boxToBounds(region.box, imageSize.width, imageSize.height))
    .filter((b): b is Bounds => b !== null);
  const spotlight = !imageError && bounds.length > 0;
  const setClampedSourceZoom = (next: number) => {
    setSourceZoom(
      Math.min(SOURCE_ZOOM_MAX, Math.max(SOURCE_ZOOM_MIN, next))
    );
  };
  const zoomSourceAt = (next: number, anchor?: { x: number; y: number }) => {
    const container = sourceDialogBodyRef.current;
    const previous = sourceZoom;
    const clamped = Math.min(SOURCE_ZOOM_MAX, Math.max(SOURCE_ZOOM_MIN, next));
    if (clamped === previous) return;

    if (!container || !anchor) {
      setSourceZoom(clamped);
      return;
    }

    const rect = container.getBoundingClientRect();
    const anchorX = anchor.x - rect.left;
    const anchorY = anchor.y - rect.top;
    const contentX = container.scrollLeft + anchorX;
    const contentY = container.scrollTop + anchorY;
    const scale = clamped / previous;

    setSourceZoom(clamped);
    requestAnimationFrame(() => {
      container.scrollLeft = contentX * scale - anchorX;
      container.scrollTop = contentY * scale - anchorY;
    });
  };
  const handleSourceWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey || Math.abs(event.deltaY) < 1) return;
    event.preventDefault();
    const sensitivity = 0.008;
    const next = sourceZoom - event.deltaY * sensitivity;
    zoomSourceAt(next, { x: event.clientX, y: event.clientY });
  };
  const renderSourceImage = (
    maskId: string,
    className = "chat-source-image"
  ) => (
    <div
      className={`${className}${spotlight ? " spotlight" : ""}`}
      style={{
        "--source-image-width": `${imageSize.width}px`,
        "--source-image-height": `${imageSize.height}px`,
        "--source-image-ratio": `${imageSize.width} / ${imageSize.height}`,
      } as CSSProperties}
    >
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
            <mask id={maskId}>
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
            mask={`url(#${maskId})`}
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
  );

  return (
    <Card className="chat-source-card open">
      <CardHeader>
        <CardTitle>来源截图</CardTitle>
        <CardDescription>
          {matched.length > 0
            ? `已定位 ${matched.length} 处来源`
            : "未定位到高亮区域"}
        </CardDescription>
      </CardHeader>
      <CardContent className="chat-source-body">
        {!imageError ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                className="chat-source-image-trigger"
                type="button"
                variant="ghost"
                aria-label="放大来源截图"
              >
                {renderSourceImage(`source-mask-${todo.id}`)}
                <span className="chat-source-zoom-hint">
                  <ZoomInIcon />
                </span>
              </Button>
            </DialogTrigger>
            <DialogContent className="chat-source-dialog">
              <DialogHeader className="chat-source-dialog-header">
                <DialogTitle>来源截图</DialogTitle>
                <DialogDescription>
                  {matched.length > 0
                    ? `已定位 ${matched.length} 处来源`
                    : "未定位到高亮区域"}
                </DialogDescription>
              </DialogHeader>
              <div
                className="chat-source-dialog-body"
                ref={sourceDialogBodyRef}
                onWheel={handleSourceWheel}
              >
                <div
                  className="chat-source-zoom-stage"
                  style={{ width: `${sourceZoom * 100}%` }}
                >
                  {renderSourceImage(
                    `source-dialog-mask-${todo.id}`,
                    "chat-source-image chat-source-image-large"
                  )}
                </div>
              </div>
              <div className="chat-source-zoom-controls">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="缩小来源截图"
                  disabled={sourceZoom <= SOURCE_ZOOM_MIN}
                  onClick={() =>
                    zoomSourceAt(sourceZoom - SOURCE_ZOOM_STEP)
                  }
                >
                  <ZoomOutIcon />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label="重置来源截图缩放"
                  onClick={() => setClampedSourceZoom(1)}
                >
                  {Math.round(sourceZoom * 100)}%
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="放大来源截图"
                  disabled={sourceZoom >= SOURCE_ZOOM_MAX}
                  onClick={() =>
                    zoomSourceAt(sourceZoom + SOURCE_ZOOM_STEP)
                  }
                >
                  <ZoomInIcon />
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <Alert variant="destructive" className="chat-source-fallback">
            <AlertDescription>截图文件不可读取：{screenshotPath}</AlertDescription>
          </Alert>
        )}
        {todo.sourceText && <pre className="chat-source-text">{todo.sourceText}</pre>}
      </CardContent>
    </Card>
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
      <Button
        aria-expanded={open}
        className="chat-thinking-head"
        onClick={() => setOpen((value) => !value)}
        size="xs"
        type="button"
        variant="ghost"
      >
        <span className="flex items-center gap-1.5">
          {live && <Spinner data-icon="inline-start" />}
          {live ? "正在思考" : "思考过程"}
        </span>
        {open ? (
          <ChevronDownIcon data-icon="inline-end" />
        ) : (
          <ChevronRightIcon data-icon="inline-end" />
        )}
      </Button>
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
  if (t.includes("/") && t.length > 28) {
    const hadTrailing = /\/$/.test(t);
    const segs = t.split("/").filter(Boolean);
    if (segs.length > 1) {
      t = "…/" + segs[segs.length - 1] + (hadTrailing ? "/" : "");
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
    <Card className={`chat-tool-card ${status}`}>
      <Accordion
        type="single"
        collapsible
        value={open ? "tool" : undefined}
        onValueChange={(value) => hasBody && setOpen(value === "tool")}
      >
        <AccordionItem value="tool">
          <AccordionTrigger className="chat-tool-head" disabled={!hasBody}>
            <span className="flex min-w-0 items-center gap-2">
              <WrenchIcon />
              <code className="chat-tool-name">{name}</code>
              {headSummary && (
                <span className="chat-tool-summary" title={summary}>
                  {headSummary}
                </span>
              )}
            </span>
            <Badge
              className="chat-tool-status"
              variant={status === "error" ? "destructive" : "secondary"}
            >
              {status === "running" ? (
                <Spinner />
              ) : status === "error" ? (
                <XCircleIcon />
              ) : (
                <CheckCircleIcon />
              )}
            </Badge>
          </AccordionTrigger>
          <AccordionContent className="chat-tool-body">
            {summary && <pre className="chat-tool-args">{summary}</pre>}
            {output && <pre className="chat-tool-output">{output}</pre>}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
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
    <Card className="ui-request chat-card">
      <CardHeader>
        <CardTitle className="ui-request-title">
          <TriangleAlertIcon />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
      {request.method === "select" && (
        <div className="ui-request-options">
          {(request.options ?? []).map((opt, i) => (
            <Button
              key={i}
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => onAnswer({ value: opt })}
            >
              {opt}
            </Button>
          ))}
        </div>
      )}
      {request.method === "confirm" && (
        <div className="ui-request-options">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer({ confirmed: true })}
          >
            确认
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onAnswer({ confirmed: false })}
          >
            否
          </Button>
        </div>
      )}
      {(request.method === "input" || request.method === "editor") && (
        <div className="ui-request-input">
          {request.method === "editor" ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              rows={3}
            />
          ) : (
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={request.placeholder ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAnswer({ value: text });
              }}
            />
          )}
          <Button
            type="button"
            disabled={disabled}
            onClick={() => onAnswer({ value: text })}
          >
            <SendIcon data-icon="inline-start" />
            提交
          </Button>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        disabled={disabled}
        onClick={() => onAnswer({ cancelled: true })}
      >
        取消
      </Button>
      </CardContent>
    </Card>
  );
}

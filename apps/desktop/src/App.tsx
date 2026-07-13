import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { TodoList } from "@/components/TodoList";
import { Settings } from "@/components/Settings";
import { AgentChatPane } from "@/components/AgentChatPane";
import { PermissionGuide } from "@/components/PermissionGuide";
import { useTodoStore, useConfigStore, useAppState, useExecutionStore } from "@/store";
import { MonitorService } from "@/services/monitor";
import { ReminderService } from "@/services/reminder";
import {
  loadConfig,
  loadTodos,
  saveTodos,
  loadTombstones,
  saveTombstones,
  loadNotifiedReminders,
  saveNotifiedReminders,
  loadChatTranscripts,
  saveChatTranscripts,
  loadToolCalls,
  saveToolCalls,
} from "@/services/storage";
import { setDebuggerConsole } from "@/services/debugger";
import {
  initExecutionListeners,
  disposeExecutionListeners,
} from "@/services/agent";
import { showMainWindow } from "@/services/window";
import { checkScreenRecordingPermission } from "@/services/permissions";
import {
  cleanupScreenshots,
  persistEvidenceScreenshots,
} from "@/services/screenshots";
import type { TodoItem, TranscriptEntry, ToolCallEntry } from "@/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PauseIcon,
  PlayIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SIDEBAR_WIDTH_KEY = "taskly.sidebarWidth";
const SIDEBAR_COLLAPSED_KEY = "taskly.sidebarCollapsed";
const CHAT_COLLAPSED_KEY = "taskly.chatCollapsed";
const SIDEBAR_DEFAULT_WIDTH = 336;
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 520;
const TODO_ONLY_WINDOW_WIDTH = 380;
const TODO_ONLY_MIN_HEIGHT = 480;
const DEFAULT_MIN_WINDOW_WIDTH = 840;
const DEFAULT_MIN_WINDOW_HEIGHT = 600;

type AppRoute = "home" | "settings";

function readRouteFromHash(): AppRoute {
  if (typeof window === "undefined") return "home";
  return window.location.hash.replace(/^#\/?/, "") === "settings"
    ? "settings"
    : "home";
}

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function readStoredSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored)
    ? clampSidebarWidth(stored)
    : SIDEBAR_DEFAULT_WIDTH;
}

function readStoredSidebarCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function readStoredChatCollapsed() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(CHAT_COLLAPSED_KEY) === "true";
}

/**
 * A live execution status (running/waiting_input/validating) persisted on disk
 * is stale after a restart (the pi child process is long gone). Downgrade those
 * to a terminal "failed" so the chat pane offers "重新执行" instead of a live
 * composer whose messages would fail, while keeping the reviewable history.
 */
function reconcileStaleRuns(todos: TodoItem[]): TodoItem[] {
  const staleLive = new Set(["running", "waiting_input", "validating"]);
  return todos.map((t) => {
    const exec = t.execution;
    if (!exec || !staleLive.has(exec.status)) return t;
    return {
      ...t,
      execution: {
        ...exec,
        status: "failed",
        finishedAt: exec.finishedAt ?? new Date().toISOString(),
        error: exec.error ?? "上次会话已随应用关闭中断，可重新执行。",
      },
    };
  });
}

function LoadingSkeleton() {
  return (
    <div className="loading-state flex flex-col gap-2" aria-label="正在加载待办">
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function SidebarIconButton({
  children,
  className,
  label,
  onClick,
  variant = "outline",
}: {
  children: ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={className}
          onClick={onClick}
          type="button"
          size="icon-sm"
          variant={variant}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function App() {
  const [route, setRoute] = useState<AppRoute>(readRouteFromHash);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readStoredSidebarCollapsed
  );
  const [chatCollapsed, setChatCollapsed] = useState(readStoredChatCollapsed);
  const [settingsNavCollapsed, setSettingsNavCollapsed] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const { todos, addTodos, setTodos, tombstones, setTombstones } = useTodoStore();
  const { config, updateConfig } = useConfigStore();
  const {
    monitoring,
    setMonitoring,
    setLastOcrText,
    setLastMonitorError,
  } = useAppState();
  const [monitor, setMonitor] = useState<MonitorService | null>(null);
  const reminderRef = useRef<ReminderService | null>(null);
  const sidebarResizeStartRef = useRef({ x: 0, width: SIDEBAR_DEFAULT_WIDTH });
  const topbarPointerToggleRef = useRef(false);
  const openTodoCount = todos.filter((todo) => !todo.done).length;

  const openSettings = useCallback(() => {
    if (window.location.hash !== "#/settings") {
      window.location.hash = "/settings";
      return;
    }
    setRoute("settings");
  }, []);

  const closeSettings = useCallback(() => {
    if (window.location.hash === "#/settings") {
      window.history.pushState(null, "", window.location.pathname);
    }
    setRoute("home");
  }, []);

  useEffect(() => {
    const syncRoute = () => setRoute(readRouteFromHash());
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  // Load saved todos on startup
  useEffect(() => {
    Promise.all([
      loadTodos(),
      loadTombstones(),
      loadChatTranscripts(),
      loadToolCalls(),
    ])
      .then(([savedTodos, savedTombstones, savedTranscripts, savedToolCalls]) => {
        if (savedTodos.length > 0) setTodos(reconcileStaleRuns(savedTodos));
        if (savedTombstones.length > 0) setTombstones(savedTombstones);
        // Reap screenshots no todo references anymore (fire-and-forget).
        void cleanupScreenshots(savedTodos);
        if (Object.keys(savedTranscripts).length > 0)
          useExecutionStore.getState().hydrateTranscripts(savedTranscripts);
        if (Object.keys(savedToolCalls).length > 0)
          useExecutionStore.getState().hydrateToolCalls(savedToolCalls);
      })
      .catch((err) => {
        console.error("Failed to load todos:", err);
      })
      .finally(() => setIsLoaded(true));
  }, [setTodos, setTombstones]);

  useEffect(() => {
    loadConfig()
      .then((saved) => {
        if (!saved) return;
        updateConfig(saved);
        if (saved.startupOpenMainWindow) {
          showMainWindow().catch((err) => {
            console.error("Failed to show main window:", err);
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load config:", err);
      });
  }, [updateConfig]);

  useEffect(() => {
    setDebuggerConsole(config.debuggerConsoleEnabled).catch((err) => {
      console.error("Failed to update debugger console:", err);
    });
  }, [config.debuggerConsoleEnabled]);

  // Check screen recording permission on startup; guide the user if missing.
  useEffect(() => {
    checkScreenRecordingPermission().then((granted) => {
      setHasPermission(granted);
      if (!granted) setShowPermissionGuide(true);
    });
  }, []);

  // Stream agent execution logs/phases into the live store.
  useEffect(() => {
    initExecutionListeners().catch((err) => {
      console.error("Failed to init execution listeners:", err);
    });
    return () => {
      void disposeExecutionListeners();
    };
  }, []);

  // Persist todos on change
  useEffect(() => {
    if (!isLoaded) return;
    saveTodos(todos);
  }, [todos, isLoaded]);

  // Persist tombstones on change
  useEffect(() => {
    if (!isLoaded) return;
    saveTombstones(tombstones);
  }, [tombstones, isLoaded]);

  // Persist agent conversation history (debounced) so it survives restarts.
  useEffect(() => {
    if (!isLoaded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (transcripts: Record<string, TranscriptEntry[]>) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveChatTranscripts(transcripts).catch((err) =>
          console.error("Failed to persist chat transcripts:", err)
        );
      }, 400);
    };
    // Persist the current snapshot, then on every subsequent change.
    flush(useExecutionStore.getState().transcripts);
    const unsub = useExecutionStore.subscribe((state, prev) => {
      if (state.transcripts !== prev.transcripts) flush(state.transcripts);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [isLoaded]);

  // Persist tool-call details (args/output) alongside the transcript so tool
  // cards keep their expandable body after a restart.
  useEffect(() => {
    if (!isLoaded) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = (
      toolCalls: Record<string, Record<string, ToolCallEntry>>
    ) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        saveToolCalls(toolCalls).catch((err) =>
          console.error("Failed to persist tool calls:", err)
        );
      }, 400);
    };
    flush(useExecutionStore.getState().toolCalls);
    const unsub = useExecutionStore.subscribe((state, prev) => {
      if (state.toolCalls !== prev.toolCalls) flush(state.toolCalls);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [isLoaded]);

  useEffect(() => {
    return () => {
      monitor?.stop();
    };
  }, [monitor]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_COLLAPSED_KEY,
      sidebarCollapsed ? "true" : "false"
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem(CHAT_COLLAPSED_KEY, chatCollapsed ? "true" : "false");
  }, [chatCollapsed]);

  const prevWindowWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const shouldShrink = route !== "settings" && chatCollapsed;
    let win: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      win = getCurrentWindow();
    } catch {
      return;
    }
    if (!win) return;

    let cancelled = false;
    const applyWindowSize = async () => {
      if (!win) return;
      try {
        const factor = await win.scaleFactor();
        const current = (await win.innerSize()).toLogical(factor);
        if (cancelled) return;
        if (shouldShrink) {
          if (prevWindowWidthRef.current == null) {
            prevWindowWidthRef.current = current.width;
          }
          await win.setMinSize(
            new LogicalSize(TODO_ONLY_WINDOW_WIDTH, TODO_ONLY_MIN_HEIGHT)
          );
          await win.setSize(
            new LogicalSize(TODO_ONLY_WINDOW_WIDTH, current.height)
          );
        } else {
          await win.setMinSize(
            new LogicalSize(DEFAULT_MIN_WINDOW_WIDTH, DEFAULT_MIN_WINDOW_HEIGHT)
          );
          const restore = prevWindowWidthRef.current;
          prevWindowWidthRef.current = null;
          if (restore != null && Math.abs(restore - current.width) > 1) {
            await win.setSize(new LogicalSize(restore, current.height));
          }
        }
      } catch {
        // Non-Tauri environment (browser preview) or missing permission — ignore.
      }
    };

    void applyWindowSize();
    return () => {
      cancelled = true;
    };
  }, [route, chatCollapsed]);

  useEffect(() => {
    if (!sidebarResizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (event: PointerEvent) => {
      const { x, width } = sidebarResizeStartRef.current;
      setSidebarWidth(clampSidebarWidth(width + event.clientX - x));
    };

    const stopResize = () => {
      setSidebarResizing(false);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [sidebarResizing]);

  // Reminder service: fire system notifications when todos become due.
  useEffect(() => {
    if (!isLoaded) return;

    if (!config.remindersEnabled) {
      reminderRef.current?.stop();
      reminderRef.current = null;
      return;
    }

    let cancelled = false;
    loadNotifiedReminders()
      .then((notified) => {
        if (cancelled) return;
        const svc = new ReminderService(
          () => useTodoStore.getState().todos,
          notified,
          (ids) => {
            saveNotifiedReminders(ids).catch((err) =>
              console.error("Failed to save reminder state:", err)
            );
          }
        );
        reminderRef.current = svc;
        svc.start().catch((err) => console.error("Failed to start reminders:", err));
      })
      .catch((err) => console.error("Failed to load reminder state:", err));

    return () => {
      cancelled = true;
      reminderRef.current?.stop();
      reminderRef.current = null;
    };
  }, [isLoaded, config.remindersEnabled]);

  // Handle new todos found by monitor: persist evidence screenshots to a
  // durable location first so they survive OS temp cleanup, then add.
  const handleTodosFound = useCallback(
    (newTodos: TodoItem[]) => {
      const ttlMs = Math.max(0, config.dedupTombstoneTtlMinutes) * 60 * 1000;
      void persistEvidenceScreenshots(newTodos)
        .then((persisted) => addTodos(persisted, ttlMs))
        .catch((err) => {
          console.error("Failed to persist evidence screenshots:", err);
          addTodos(newTodos, ttlMs);
        });
    },
    [addTodos, config.dedupTombstoneTtlMinutes]
  );

  // Toggle monitoring
  const toggleMonitoring = async () => {
    if (monitoring) {
      monitor?.stop();
      setMonitoring(false);
      setLastMonitorError("");
    } else {
      // Re-check permission before starting; capture won't work without it.
      const granted = await checkScreenRecordingPermission();
      setHasPermission(granted);
      if (!granted) {
        setShowPermissionGuide(true);
        setLastMonitorError("缺少屏幕录制权限，无法截图");
        return;
      }
      try {
        const svc = new MonitorService(config, handleTodosFound, {
          onOcrText: (text) => {
            setLastOcrText(text);
            setLastMonitorError("");
          },
          onError: (message) => setLastMonitorError(message),
          getKnownTitles: () =>
            useTodoStore
              .getState()
              .todos.filter((t) => !t.done)
              .map((t) => t.title),
        });
        await svc.start();
        setMonitor(svc);
        setMonitoring(true);
        setLastMonitorError("");
      } catch (err) {
        console.error("Failed to start monitor:", err);
        const message = err instanceof Error ? err.message : String(err);
        setLastMonitorError(message);
      }
    }
  };

  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (sidebarCollapsed) return;
      event.preventDefault();
      sidebarResizeStartRef.current = {
        x: event.clientX,
        width: sidebarWidth,
      };
      setSidebarResizing(true);
    },
    [sidebarCollapsed, sidebarWidth]
  );

  const resizeSidebarWithKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      setSidebarWidth((width) => clampSidebarWidth(width + direction * 16));
    },
    []
  );

  const isSettingsRoute = route === "settings";
  const todoOnlyMode = !isSettingsRoute && chatCollapsed;
  const activeNavCollapsed = isSettingsRoute
    ? settingsNavCollapsed
    : chatCollapsed;
  const activeNavLabel = activeNavCollapsed
    ? isSettingsRoute
      ? "展开设置导航"
      : "展开聊天区域"
    : isSettingsRoute
    ? "折叠设置导航"
    : "折叠聊天区域";

  return (
    <div className={`app${todoOnlyMode ? " todo-only" : ""}`}>
      <header
        className="app-topbar"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-no-window-drag='true']")) return;
          void getCurrentWindow().startDragging().catch((err) => {
            console.error("Failed to start window dragging:", err);
          });
        }}
      >
        <div className="app-topbar-left">
          {isSettingsRoute ? (
            <Button
              aria-label={activeNavLabel}
              title={activeNavLabel}
              type="button"
              variant="ghost"
              size="icon-sm"
              data-no-window-drag="true"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                topbarPointerToggleRef.current = true;
                window.setTimeout(() => {
                  topbarPointerToggleRef.current = false;
                }, 400);
                setSettingsNavCollapsed((collapsed) => !collapsed);
              }}
              onClick={(event) => {
                if (event.detail > 0 && topbarPointerToggleRef.current) return;
                setSettingsNavCollapsed((collapsed) => !collapsed);
              }}
            >
              {activeNavCollapsed ? (
                <PanelLeftOpenIcon />
              ) : (
                <PanelLeftCloseIcon />
              )}
            </Button>
          ) : (
            <Button
              aria-label={activeNavLabel}
              title={activeNavLabel}
              type="button"
              variant="ghost"
              size="icon-sm"
              data-no-window-drag="true"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                topbarPointerToggleRef.current = true;
                window.setTimeout(() => {
                  topbarPointerToggleRef.current = false;
                }, 400);
                setChatCollapsed((collapsed) => {
                  const next = !collapsed;
                  if (next && sidebarCollapsed) setSidebarCollapsed(false);
                  return next;
                });
              }}
              onClick={(event) => {
                if (event.detail > 0 && topbarPointerToggleRef.current) return;
                setChatCollapsed((collapsed) => {
                  const next = !collapsed;
                  if (next && sidebarCollapsed) setSidebarCollapsed(false);
                  return next;
                });
              }}
            >
              {activeNavCollapsed ? (
                <PanelRightOpenIcon />
              ) : (
                <PanelRightCloseIcon />
              )}
            </Button>
          )}
        </div>
        <nav className="app-topbar-history" aria-label="页面导航">
          <Button
            aria-label="后退"
            type="button"
            variant="ghost"
            size="icon-sm"
            data-no-window-drag="true"
            onClick={isSettingsRoute ? closeSettings : undefined}
            disabled={!isSettingsRoute}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            aria-label="前进"
            type="button"
            variant="ghost"
            size="icon-sm"
            data-no-window-drag="true"
            disabled
          >
            <ChevronRightIcon />
          </Button>
        </nav>
      </header>

      {!hasPermission && !showPermissionGuide && (
        <Alert
          className="permission-banner cursor-pointer"
          onClick={() => setShowPermissionGuide(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setShowPermissionGuide(true);
            }
          }}
        >
          <TriangleAlertIcon />
          <AlertDescription>
            缺少屏幕录制权限，截图与识别将无法工作，点击查看如何开启
          </AlertDescription>
        </Alert>
      )}

      {isSettingsRoute ? (
        <main
          className={`settings-route${
            settingsNavCollapsed ? " settings-nav-collapsed" : ""
          }`}
        >
          <Settings onClose={closeSettings} />
        </main>
      ) : (
        <div
          className={`app-body${sidebarResizing ? " sidebar-resizing" : ""}${
            chatCollapsed ? " chat-collapsed" : ""
          }`}
        >
          <aside
            className={`app-sidebar${sidebarCollapsed ? " collapsed" : ""}${
              sidebarResizing ? " resizing" : ""
            }`}
            style={
              sidebarCollapsed || chatCollapsed
                ? undefined
                : { width: sidebarWidth }
            }
          >
            {sidebarCollapsed ? (
              <div className="sidebar-rail">
                <SidebarIconButton
                  className={monitoring ? "active" : undefined}
                  label={monitoring ? "暂停监控" : "开始监控"}
                  onClick={toggleMonitoring}
                  variant={monitoring ? "default" : "outline"}
                >
                  {monitoring ? <PauseIcon /> : <PlayIcon />}
                </SidebarIconButton>
                <div className="sidebar-rail-spacer" />
                <SidebarIconButton label="打开设置" onClick={openSettings}>
                  <SettingsIcon />
                </SidebarIconButton>
              </div>
            ) : (
              <>
                <div className="sidebar-header">
                  <div className="sidebar-heading-copy">
                    <span className="sidebar-kicker">Taskly</span>
                  </div>
                  <div className="sidebar-header-actions">
                    <Badge variant={monitoring ? "default" : "outline"}>
                      {monitoring ? "监控中" : `${openTodoCount} 个待办`}
                    </Badge>
                  </div>
                </div>
                <ScrollArea className="sidebar-scroll">
                  {isLoaded ? <TodoList /> : <LoadingSkeleton />}
                </ScrollArea>
                <div className="sidebar-controls">
                  <span className="sidebar-version">v{__APP_VERSION__}</span>
                  <div className="sidebar-controls-actions">
                    <SidebarIconButton
                      className={monitoring ? "active" : undefined}
                      label={monitoring ? "暂停监控" : "开始监控"}
                      onClick={toggleMonitoring}
                      variant={monitoring ? "default" : "outline"}
                    >
                      {monitoring ? <PauseIcon /> : <PlayIcon />}
                    </SidebarIconButton>
                    <SidebarIconButton label="打开设置" onClick={openSettings}>
                      <SettingsIcon />
                    </SidebarIconButton>
                  </div>
                </div>
                <div
                  aria-label="调整侧边栏宽度"
                  aria-orientation="vertical"
                  className="sidebar-resize-handle"
                  onKeyDown={resizeSidebarWithKeyboard}
                  onPointerDown={startSidebarResize}
                  role="separator"
                  tabIndex={0}
                />
              </>
            )}
          </aside>
          {!chatCollapsed && (
            <section className="app-chat">
              <AgentChatPane />
            </section>
          )}
        </div>
      )}
      {showPermissionGuide && (
        <PermissionGuide
          onGranted={() => {
            setHasPermission(true);
            setShowPermissionGuide(false);
          }}
          onDismiss={() => setShowPermissionGuide(false)}
        />
      )}
    </div>
  );
}

export default App;

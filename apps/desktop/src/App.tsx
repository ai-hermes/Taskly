import { useState, useEffect, useCallback, useRef } from "react";
import { TodoList } from "@/components/TodoList";
import { Settings } from "@/components/Settings";
import { CopilotPanel } from "@/components/CopilotPanel";
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
import type { TodoItem, TranscriptEntry, ToolCallEntry } from "@/types";
import { GearSix, Pause, Play, Robot, Warning } from "@phosphor-icons/react";

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
    <div className="loading-state" aria-label="正在加载待办">
      <div className="skeleton-row skeleton-row-strong" />
      <div className="skeleton-row" />
      <div className="skeleton-row skeleton-row-short" />
    </div>
  );
}

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const { todos, addTodos, setTodos, tombstones, setTombstones } = useTodoStore();
  const { config, updateConfig } = useConfigStore();
  const {
    monitoring,
    setMonitoring,
    copilotVisible,
    setCopilotVisible,
    setLastOcrText,
    setLastMonitorError,
  } = useAppState();
  const [monitor, setMonitor] = useState<MonitorService | null>(null);
  const reminderRef = useRef<ReminderService | null>(null);

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

  // Handle new todos found by monitor
  const handleTodosFound = useCallback(
    (newTodos: TodoItem[]) => {
      const ttlMs = Math.max(0, config.dedupTombstoneTtlMinutes) * 60 * 1000;
      addTodos(newTodos, ttlMs);
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

  return (
    <div className="app">
      {!hasPermission && !showPermissionGuide && (
        <div className="permission-banner" onClick={() => setShowPermissionGuide(true)}>
          <Warning size={15} weight="fill" />
          <span>缺少屏幕录制权限，截图与识别将无法工作，点击查看如何开启</span>
        </div>
      )}

      <div className="app-body">
        <aside className="app-sidebar">
          <div className="sidebar-scroll">
            {isLoaded ? <TodoList /> : <LoadingSkeleton />}
          </div>
          <div className="sidebar-controls">
            <span className="sidebar-version">v{__APP_VERSION__}</span>
            <div className="sidebar-controls-actions">
            <button
              className={`btn-icon has-tip ${monitoring ? "active" : ""}`}
              onClick={toggleMonitoring}
              type="button"
              data-tip={monitoring ? "暂停监控" : "开始监控"}
              aria-label={monitoring ? "暂停监控" : "开始监控"}
            >
              {monitoring ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}
            </button>
            <button
              className={`btn-icon has-tip ${copilotVisible ? "active" : ""}`}
              onClick={() => setCopilotVisible(!copilotVisible)}
              type="button"
              aria-label="打开 Copilot"
              data-tip="Copilot"
            >
              <Robot size={17} />
            </button>
            <button
              className="btn-icon has-tip"
              onClick={() => setShowSettings(true)}
              type="button"
              aria-label="打开设置"
              data-tip="设置"
            >
              <GearSix size={17} />
            </button>
            </div>
          </div>
        </aside>
        <section className="app-chat">
          <AgentChatPane />
        </section>
      </div>

      {copilotVisible && <CopilotPanel />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
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

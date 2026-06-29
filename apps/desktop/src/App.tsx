import { useState, useEffect, useCallback } from "react";
import { TodoList } from "@/components/TodoList";
import { Settings } from "@/components/Settings";
import { CopilotPanel } from "@/components/CopilotPanel";
import { useTodoStore, useConfigStore, useAppState } from "@/store";
import { MonitorService } from "@/services/monitor";
import { loadConfig, loadTodos, saveTodos } from "@/services/storage";
import { setDebuggerConsole } from "@/services/debugger";
import { showMainWindow } from "@/services/window";
import type { TodoItem } from "@/types";
import { GearSix, Pause, Play, Robot } from "@phosphor-icons/react";

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
  const [monitorError, setMonitorError] = useState("");
  const { todos, addTodos, setTodos } = useTodoStore();
  const { config, updateConfig } = useConfigStore();
  const { monitoring, setMonitoring, copilotVisible, setCopilotVisible } = useAppState();
  const [monitor, setMonitor] = useState<MonitorService | null>(null);

  // Load saved todos on startup
  useEffect(() => {
    loadTodos()
      .then((saved) => {
        if (saved.length > 0) setTodos(saved);
      })
      .catch((err) => {
        console.error("Failed to load todos:", err);
      })
      .finally(() => setIsLoaded(true));
  }, [setTodos]);

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

  // Persist todos on change
  useEffect(() => {
    if (!isLoaded) return;
    saveTodos(todos);
  }, [todos, isLoaded]);

  useEffect(() => {
    return () => {
      monitor?.stop();
    };
  }, [monitor]);

  // Handle new todos found by monitor
  const handleTodosFound = useCallback(
    (newTodos: TodoItem[]) => {
      addTodos(newTodos);
    },
    [addTodos]
  );

  // Toggle monitoring
  const toggleMonitoring = () => {
    setMonitorError("");
    if (monitoring) {
      monitor?.stop();
      setMonitoring(false);
    } else {
      try {
        const svc = new MonitorService(config, handleTodosFound);
        svc.start();
        setMonitor(svc);
        setMonitoring(true);
      } catch (err) {
        console.error("Failed to start monitor:", err);
        setMonitorError("监控启动失败。请检查系统权限和模型设置。");
      }
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Taskly</h1>
          <span>本地识别聊天待办</span>
        </div>
        <div className="header-actions">
          <button
            className={`btn-monitor ${monitoring ? "active" : ""}`}
            onClick={toggleMonitoring}
            type="button"
          >
            {monitoring ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            <span>{monitoring ? "暂停监控" : "开始监控"}</span>
          </button>
          <button
            className="btn-icon"
            onClick={() => setCopilotVisible(!copilotVisible)}
            type="button"
            aria-label="打开 Copilot"
            title="打开 Copilot"
          >
            <Robot size={18} />
          </button>
          <button
            className="btn-icon"
            onClick={() => setShowSettings(true)}
            type="button"
            aria-label="打开设置"
            title="设置"
          >
            <GearSix size={18} />
          </button>
        </div>
      </header>

      {monitorError && <p className="app-error" role="alert">{monitorError}</p>}

      <main className="app-main">
        {isLoaded ? <TodoList /> : <LoadingSkeleton />}
      </main>

      {copilotVisible && <CopilotPanel />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default App;

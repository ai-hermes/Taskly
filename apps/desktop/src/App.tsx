import { useState, useEffect, useCallback } from "react";
import { TodoList } from "@/components/TodoList";
import { Settings } from "@/components/Settings";
import { CopilotPanel } from "@/components/CopilotPanel";
import { PermissionGuide } from "@/components/PermissionGuide";
import { useTodoStore, useConfigStore, useAppState } from "@/store";
import { MonitorService } from "@/services/monitor";
import { loadTodos, saveTodos } from "@/services/storage";
import { checkScreenRecordingPermission } from "@/services/permissions";
import type { TodoItem } from "@/types";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const { todos, addTodos, setTodos } = useTodoStore();
  const { config } = useConfigStore();
  const {
    monitoring,
    setMonitoring,
    copilotVisible,
    setCopilotVisible,
    setLastOcrText,
    setLastMonitorError,
  } = useAppState();
  const [monitor, setMonitor] = useState<MonitorService | null>(null);

  // Load saved todos on startup
  useEffect(() => {
    loadTodos().then((saved) => {
      if (saved.length > 0) setTodos(saved);
      setIsLoaded(true);
    });
  }, [setTodos]);

  // Check screen recording permission on startup; guide the user if missing.
  useEffect(() => {
    checkScreenRecordingPermission().then((granted) => {
      setHasPermission(granted);
      if (!granted) setShowPermissionGuide(true);
    });
  }, []);

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
      <header className="app-header">
        <h1>📋 Taskly</h1>
        <div className="header-actions">
          <button
            className={`btn-monitor ${monitoring ? "active" : ""}`}
            onClick={toggleMonitoring}
          >
            {monitoring ? "⏸ 暂停" : "▶ 开始监控"}
          </button>
          <button
            className="btn-icon"
            onClick={() => setCopilotVisible(!copilotVisible)}
            title="Copilot"
          >
            🤖
          </button>
          <button
            className="btn-icon"
            onClick={() => setShowSettings(true)}
            title="设置"
          >
            ⚙️
          </button>
        </div>
      </header>

      {!hasPermission && !showPermissionGuide && (
        <div className="permission-banner" onClick={() => setShowPermissionGuide(true)}>
          ⚠️ 缺少屏幕录制权限，截图与识别将无法工作 —— 点击查看如何开启
        </div>
      )}

      <main className="app-main">
        <TodoList />
      </main>

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

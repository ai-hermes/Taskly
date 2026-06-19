import { useState, useEffect, useCallback } from "react";
import { TodoList } from "@/components/TodoList";
import { Settings } from "@/components/Settings";
import { CopilotPanel } from "@/components/CopilotPanel";
import { useTodoStore, useConfigStore, useAppState } from "@/store";
import { MonitorService } from "@/services/monitor";
import { loadTodos, saveTodos } from "@/services/storage";
import type { TodoItem } from "@/types";

function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const { todos, addTodos, setTodos } = useTodoStore();
  const { config } = useConfigStore();
  const { monitoring, setMonitoring, copilotVisible, setCopilotVisible } = useAppState();
  const [monitor, setMonitor] = useState<MonitorService | null>(null);

  // Load saved todos on startup
  useEffect(() => {
    loadTodos().then((saved) => {
      if (saved.length > 0) setTodos(saved);
      setIsLoaded(true);
    });
  }, [setTodos]);

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

      <main className="app-main">
        <TodoList />
      </main>

      {copilotVisible && <CopilotPanel />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default App;

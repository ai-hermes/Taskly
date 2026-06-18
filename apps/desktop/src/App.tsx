import { useState } from "react";

function App() {
  const [todos, setTodos] = useState<
    { id: string; title: string; done: boolean }[]
  >([]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>📋 Taskly</h1>
        <p className="subtitle">智能待办识别与管理</p>
      </header>

      <main className="app-main">
        {todos.length === 0 ? (
          <div className="empty-state">
            <p>暂无待办事项</p>
            <p className="hint">Taskly 正在监控您的微信窗口，发现待办时会自动添加</p>
          </div>
        ) : (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li key={todo.id} className={todo.done ? "done" : ""}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() =>
                    setTodos((prev) =>
                      prev.map((t) =>
                        t.id === todo.id ? { ...t, done: !t.done } : t
                      )
                    )
                  }
                />
                <span>{todo.title}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

export default App;

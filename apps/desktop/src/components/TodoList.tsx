import { useTodoStore } from "@/store";

export function TodoList() {
  const { todos, toggleTodo, removeTodo } = useTodoStore();

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="todo-list-container">
      <div className="todo-section">
        <h3>📋 待办 ({pending.length})</h3>
        {pending.length === 0 ? (
          <p className="empty-hint">暂无待办事项</p>
        ) : (
          <ul className="todo-list">
            {pending.map((todo) => (
              <li key={todo.id} className="todo-item">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggleTodo(todo.id)}
                />
                <div className="todo-content">
                  <span className="todo-title">{todo.title}</span>
                  {todo.description && (
                    <span className="todo-desc">{todo.description}</span>
                  )}
                  {todo.dueDate && (
                    <span className="todo-due">
                      📅 {new Date(todo.dueDate).toLocaleDateString("zh-CN")}
                    </span>
                  )}
                </div>
                <button className="todo-delete" onClick={() => removeTodo(todo.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="todo-section">
          <h3>✅ 已完成 ({done.length})</h3>
          <ul className="todo-list">
            {done.map((todo) => (
              <li key={todo.id} className="todo-item done">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggleTodo(todo.id)}
                />
                <div className="todo-content">
                  <span className="todo-title">{todo.title}</span>
                </div>
                <button className="todo-delete" onClick={() => removeTodo(todo.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

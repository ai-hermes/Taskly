import { useTodoStore } from "@/store";

/**
 * Lightweight widget view for the always-on-top todo window.
 * This component is rendered in a separate Tauri window.
 */
export function TodoWidget() {
  const { todos, toggleTodo } = useTodoStore();
  const pending = todos.filter((t) => !t.done).slice(0, 5);

  return (
    <div className="widget-container">
      <div className="widget-header" data-tauri-drag-region>
        <span>📋 今日待办</span>
        <span className="widget-count">{pending.length}</span>
      </div>
      <div className="widget-body">
        {pending.length === 0 ? (
          <p className="widget-empty">🎉 全部完成！</p>
        ) : (
          <ul className="widget-list">
            {pending.map((todo) => (
              <li key={todo.id}>
                <input
                  type="checkbox"
                  onChange={() => toggleTodo(todo.id)}
                />
                <span>{todo.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

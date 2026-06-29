import { useTodoStore } from "@/store";
import { CalendarBlank, Check, Trash } from "@phosphor-icons/react";

export function TodoList() {
  const { todos, toggleTodo, removeTodo } = useTodoStore();

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <div className="todo-list-container">
      <div className="todo-section">
        <div className="section-heading">
          <h3>待办</h3>
          <span>{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="empty-hint">
            <p>暂无待办事项</p>
            <span>开始监控后，Taskly 会把聊天里的待办放在这里。</span>
          </div>
        ) : (
          <ul className="todo-list">
            {pending.map((todo) => (
              <li key={todo.id} className="todo-item">
                <label className="todo-check">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => toggleTodo(todo.id)}
                    aria-label={`完成 ${todo.title}`}
                  />
                  <span />
                </label>
                <div className="todo-content">
                  <span className="todo-title">{todo.title}</span>
                  {todo.description && (
                    <span className="todo-desc">{todo.description}</span>
                  )}
                  {todo.dueDate && (
                    <span className="todo-due">
                      <CalendarBlank size={13} />
                      {new Date(todo.dueDate).toLocaleDateString("zh-CN")}
                    </span>
                  )}
                </div>
                <button
                  className="todo-delete"
                  onClick={() => removeTodo(todo.id)}
                  type="button"
                  aria-label={`删除 ${todo.title}`}
                >
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {done.length > 0 && (
        <div className="todo-section">
          <div className="section-heading">
            <h3>已完成</h3>
            <span>{done.length}</span>
          </div>
          <ul className="todo-list">
            {done.map((todo) => (
              <li key={todo.id} className="todo-item done">
                <label className="todo-check">
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => toggleTodo(todo.id)}
                    aria-label={`恢复 ${todo.title}`}
                  />
                  <span>
                    <Check size={12} weight="bold" />
                  </span>
                </label>
                <div className="todo-content">
                  <span className="todo-title">{todo.title}</span>
                </div>
                <button
                  className="todo-delete"
                  onClick={() => removeTodo(todo.id)}
                  type="button"
                  aria-label={`删除 ${todo.title}`}
                >
                  <Trash size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

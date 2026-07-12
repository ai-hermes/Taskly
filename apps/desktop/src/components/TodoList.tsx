import { useState } from "react";
import { useTodoStore, useExecutionStore } from "@/store";
import { startInteractiveRun, validateReadyToExecute } from "@/services/agent";
import { TodoEditModal } from "./TodoEditModal";
import type { TodoItem } from "@/types";
import { Check, PencilSimple, Play, Trash } from "@phosphor-icons/react";

export function TodoList() {
  const { todos, toggleTodo, removeTodo } = useTodoStore();
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pending = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);
  const editingTodo = todos.find((t) => t.id === editingId);

  const runTodo = async (todo: TodoItem) => {
    setActiveTodo(todo.id);
    try {
      await startInteractiveRun(todo.id);
    } catch {
      // Failure state is reflected in the store and console.
    }
  };

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
              <li
                key={todo.id}
                className={`todo-item ${activeTodoId === todo.id ? "active" : ""}`}
                onClick={() => setActiveTodo(todo.id)}
              >
                <label className="todo-check" onClick={(e) => e.stopPropagation()}>
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
                </div>
                <div className="todo-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="todo-edit todo-run"
                    onClick={() => runTodo(todo)}
                    type="button"
                    disabled={
                      validateReadyToExecute(todo.id) !== null ||
                      todo.execution?.status === "running" ||
                      todo.execution?.status === "waiting_input" ||
                      todo.execution?.status === "validating"
                    }
                    aria-label={`一键执行 ${todo.title}`}
                    title={validateReadyToExecute(todo.id) ?? "一键执行"}
                  >
                    <Play size={15} />
                  </button>
                  <button
                    className="todo-edit"
                    onClick={() => setEditingId(todo.id)}
                    type="button"
                    aria-label={`编辑 ${todo.title}`}
                    title="编辑"
                  >
                    <PencilSimple size={15} />
                  </button>
                  <button
                    className="todo-delete"
                    onClick={() => removeTodo(todo.id)}
                    type="button"
                    aria-label={`删除 ${todo.title}`}
                    title="删除"
                  >
                    <Trash size={15} />
                  </button>
                </div>
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
              <li
                key={todo.id}
                className={`todo-item done ${activeTodoId === todo.id ? "active" : ""}`}
                onClick={() => setActiveTodo(todo.id)}
              >
                <label className="todo-check" onClick={(e) => e.stopPropagation()}>
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
                <div className="todo-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="todo-delete"
                    onClick={() => removeTodo(todo.id)}
                    type="button"
                    aria-label={`删除 ${todo.title}`}
                    title="删除"
                  >
                    <Trash size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editingTodo && (
        <TodoEditModal todo={editingTodo} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

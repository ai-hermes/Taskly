import { useState } from "react";
import { useTodoStore, useExecutionStore } from "@/store";
import { startInteractiveRun, validateReadyToExecute } from "@/services/agent";
import { TodoEditModal } from "./TodoEditModal";
import type { TodoItem } from "@/types";
import { CaretDown, Check, CheckCircle, PencilSimple, Play, Trash } from "@phosphor-icons/react";

export function TodoList() {
  const { todos, toggleTodo, removeTodo, confirmTodo } = useTodoStore();
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState({
    confirmed: true,
    pending: true,
    done: false,
  });

  const pending = todos.filter((t) => !t.done && t.reviewStatus === "pending_confirmation");
  const confirmed = todos.filter((t) => !t.done && t.reviewStatus !== "pending_confirmation");
  const done = todos.filter((t) => t.done);
  const editingTodo = todos.find((t) => t.id === editingId);
  const toggleSection = (key: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

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
        <button className="section-heading section-toggle" onClick={() => toggleSection("confirmed")} type="button">
          <div className="section-heading-main">
            <h3>已确认</h3>
            <span className="section-count">{confirmed.length}</span>
          </div>
          <CaretDown className={expanded.confirmed ? "open" : ""} size={14} />
        </button>
        {expanded.confirmed && confirmed.length === 0 ? (
          <div className="empty-hint compact">
            <p>暂无已确认待办</p>
          </div>
        ) : null}
        {expanded.confirmed && confirmed.length > 0 ? (
          <ul className="todo-list">
            {confirmed.map((todo) => (
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
                  {todo.todoKind === "notification" && <span className="todo-pill">仅通知</span>}
                </div>
                <div className="todo-actions" onClick={(e) => e.stopPropagation()}>
                  {todo.todoKind !== "notification" && (
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
                  )}
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
        ) : null}
      </div>

      <div className="todo-section">
        <button className="section-heading section-toggle" onClick={() => toggleSection("pending")} type="button">
          <div className="section-heading-main">
            <h3>待确认</h3>
            <span className="section-count">{pending.length}</span>
          </div>
          <CaretDown className={expanded.pending ? "open" : ""} size={14} />
        </button>
        {expanded.pending && pending.length === 0 ? (
          <div className="empty-hint">
            <p>暂无待确认事项</p>
            <span>自动抓取的 todo 会先进入这里，确认后才进入已确认。</span>
          </div>
        ) : null}
        {expanded.pending && pending.length > 0 ? (
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
                  <div className="todo-inline-meta">
                    <span className="todo-pill pending">待确认</span>
                    {todo.todoKind === "notification" && <span className="todo-pill">仅通知</span>}
                  </div>
                </div>
                <div className="todo-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="todo-edit"
                    onClick={() => confirmTodo(todo.id)}
                    type="button"
                    aria-label={`确认 ${todo.title}`}
                    title="确认并移入已确认"
                  >
                    <CheckCircle size={15} />
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
        ) : null}
      </div>

      <div className="todo-section">
        <button className="section-heading section-toggle" onClick={() => toggleSection("done")} type="button">
          <div className="section-heading-main">
            <h3>已完成</h3>
            <span className="section-count">{done.length}</span>
          </div>
          <CaretDown className={expanded.done ? "open" : ""} size={14} />
        </button>
        {expanded.done && done.length === 0 ? (
          <div className="empty-hint compact">
            <p>暂无已完成事项</p>
          </div>
        ) : null}
        {expanded.done && done.length > 0 && (
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
        )}
      </div>

      {editingTodo && (
        <TodoEditModal todo={editingTodo} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

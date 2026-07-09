import { useState } from "react";
import { useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import {
  CalendarBlank,
  Check,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";

export function TodoList() {
  const { todos, toggleTodo, removeTodo, updateTodo } = useTodoStore();
  const [editingId, setEditingId] = useState<string | null>(null);

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
            {pending.map((todo) =>
              editingId === todo.id ? (
                <TodoEditor
                  key={todo.id}
                  todo={todo}
                  onSave={(patch) => {
                    updateTodo(todo.id, patch);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
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
                  <div className="todo-actions">
                    <button
                      className="todo-edit"
                      onClick={() => setEditingId(todo.id)}
                      type="button"
                      aria-label={`编辑 ${todo.title}`}
                    >
                      <PencilSimple size={15} />
                    </button>
                    <button
                      className="todo-delete"
                      onClick={() => removeTodo(todo.id)}
                      type="button"
                      aria-label={`删除 ${todo.title}`}
                    >
                      <Trash size={15} />
                    </button>
                  </div>
                </li>
              )
            )}
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
                <div className="todo-actions">
                  <button
                    className="todo-delete"
                    onClick={() => removeTodo(todo.id)}
                    type="button"
                    aria-label={`删除 ${todo.title}`}
                  >
                    <Trash size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function toDateInputValue(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function TodoEditor({
  todo,
  onSave,
  onCancel,
}: {
  todo: TodoItem;
  onSave: (patch: Partial<TodoItem>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [dueDate, setDueDate] = useState(toDateInputValue(todo.dueDate));

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onSave({
      title: trimmed,
      description: description.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
    });
  };

  return (
    <li className="todo-item editing">
      <div className="todo-editor">
        <input
          className="todo-editor-title"
          type="text"
          value={title}
          placeholder="待办标题"
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onCancel();
            }
          }}
        />
        <textarea
          className="todo-editor-desc"
          value={description}
          placeholder="描述（可选）"
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="todo-editor-row">
          <label className="todo-editor-field">
            <span>截止日期</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
          <div className="todo-editor-actions">
            <button
              type="button"
              className="todo-editor-cancel"
              onClick={onCancel}
            >
              <X size={14} />
              取消
            </button>
            <button
              type="button"
              className="todo-editor-save"
              onClick={submit}
              disabled={!title.trim()}
            >
              <Check size={14} weight="bold" />
              保存
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

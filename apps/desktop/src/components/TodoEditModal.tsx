import { useState } from "react";
import { useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import { Check, X } from "@phosphor-icons/react";

function toDateInputValue(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

/** Modal editor for a todo's title / description / due date. */
export function TodoEditModal({
  todo,
  onClose,
}: {
  todo: TodoItem;
  onClose: () => void;
}) {
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description ?? "");
  const [dueDate, setDueDate] = useState(toDateInputValue(todo.dueDate));

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    updateTodo(todo.id, {
      title: trimmed,
      description: description.trim(),
      dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
    });
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>编辑待办</h3>
          <button className="modal-close" onClick={onClose} type="button" aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        <div className="workspace-field">
          <label>标题</label>
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
                onClose();
              }
            }}
          />
        </div>

        <div className="workspace-field">
          <label>描述（可选）</label>
          <textarea
            className="todo-editor-desc"
            value={description}
            placeholder="描述（可选）"
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="workspace-field">
          <label>截止日期（可选）</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={!title.trim()}
          >
            <Check size={14} weight="bold" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

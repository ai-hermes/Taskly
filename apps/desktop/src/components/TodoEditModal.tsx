import { useState } from "react";
import { useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import { CalendarBlank, Check, X } from "@phosphor-icons/react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Parse a stored ISO date into a local Date (undefined when empty/invalid). */
function parseDueDate(iso?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Serialize a picked local date-time back to an ISO string. */
function dueDateToIso(date?: Date): string | undefined {
  if (!date) return undefined;
  return date.toISOString();
}

function formatDueDate(date?: Date): string {
  if (!date) return "";
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:mm:ss" value for the time input. */
function toTimeInputValue(date?: Date): string {
  if (!date) return "";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
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
  const [dueDate, setDueDate] = useState<Date | undefined>(
    parseDueDate(todo.dueDate),
  );
  const [dueDateOpen, setDueDateOpen] = useState(false);

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    updateTodo(todo.id, {
      title: trimmed,
      description: description.trim(),
      dueDate: dueDateToIso(dueDate),
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
          <FieldGroup className="flex-row gap-3">
            <Field>
              <FieldLabel htmlFor="due-date" className="text-muted-foreground">
                日期
              </FieldLabel>
              <Popover open={dueDateOpen} onOpenChange={setDueDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    id="due-date"
                    variant="outline"
                    className="w-40 justify-between font-normal data-[empty=true]:text-muted-foreground"
                    data-empty={!dueDate}
                  >
                    <span className="flex items-center gap-2">
                      <CalendarBlank size={16} />
                      {dueDate ? formatDueDate(dueDate) : "选择日期"}
                    </span>
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="z-[70] w-auto overflow-hidden p-0"
                  align="start"
                >
                  <Calendar
                    mode="single"
                    selected={dueDate}
                    captionLayout="dropdown"
                    defaultMonth={dueDate}
                    onSelect={(date) => {
                      if (!date) {
                        setDueDate(undefined);
                        return;
                      }
                      const base = dueDate ?? new Date();
                      const merged = new Date(date);
                      merged.setHours(
                        base.getHours(),
                        base.getMinutes(),
                        base.getSeconds(),
                        0,
                      );
                      setDueDate(merged);
                      setDueDateOpen(false);
                    }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </Field>
            <Field className="w-32">
              <FieldLabel htmlFor="due-time" className="text-muted-foreground">
                时间
              </FieldLabel>
              <Input
                type="time"
                id="due-time"
                step="1"
                lang="en-GB"
                value={toTimeInputValue(dueDate)}
                onChange={(e) => {
                  const value = e.target.value;
                  if (!value) return;
                  const [h, m, s] = value.split(":").map(Number);
                  const base = dueDate ?? new Date();
                  const merged = new Date(base);
                  merged.setHours(h || 0, m || 0, s || 0, 0);
                  setDueDate(merged);
                }}
                className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
              />
            </Field>
          </FieldGroup>
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

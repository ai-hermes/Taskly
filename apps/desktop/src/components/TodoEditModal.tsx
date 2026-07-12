import { useState } from "react";
import { CalendarIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

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
    date.getSeconds()
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
    parseDueDate(todo.dueDate)
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="modal max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑待办</DialogTitle>
          <DialogDescription>调整标题、描述和截止时间。</DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <Field data-invalid={!title.trim()}>
            <FieldLabel htmlFor="todo-title">标题</FieldLabel>
            <Input
              id="todo-title"
              value={title}
              placeholder="待办标题"
              autoFocus
              aria-invalid={!title.trim()}
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                } else if (event.key === "Escape") {
                  onClose();
                }
              }}
            />
            {!title.trim() && (
              <FieldDescription>标题不能为空。</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="todo-description">描述（可选）</FieldLabel>
            <Textarea
              id="todo-description"
              value={description}
              placeholder="描述（可选）"
              rows={3}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel>截止日期（可选）</FieldLabel>
            <FieldGroup className="flex-row gap-3">
              <Field>
                <FieldLabel
                  htmlFor="due-date"
                  className="text-muted-foreground"
                >
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
                        <CalendarIcon data-icon="inline-start" />
                        {dueDate ? formatDueDate(dueDate) : "选择日期"}
                      </span>
                      <ChevronDownIcon data-icon="inline-end" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto overflow-hidden p-0" align="start">
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
                          0
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
                <FieldLabel
                  htmlFor="due-time"
                  className="text-muted-foreground"
                >
                  时间
                </FieldLabel>
                <Input
                  type="time"
                  id="due-time"
                  step="1"
                  lang="en-GB"
                  value={toTimeInputValue(dueDate)}
                  onChange={(event) => {
                    const value = event.target.value;
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
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={submit} disabled={!title.trim()}>
            <CheckIcon data-icon="inline-start" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState, type ComponentProps, type ReactNode } from "react";
import {
  CheckCircleIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { startInteractiveRun, validateReadyToExecute } from "@/services/agent";
import { useExecutionStore, useTodoStore } from "@/store";
import type { TodoItem } from "@/types";
import { cn } from "@/lib/utils";
import { TodoEditModal } from "./TodoEditModal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TodoSectionKey = "confirmed" | "pending" | "done";

interface TodoSectionProps {
  emptyDescription?: string;
  emptyTitle: string;
  items: TodoItem[];
  onConfirm: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onRun: (todo: TodoItem) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selectedId: string | null;
  title: string;
  value: TodoSectionKey;
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
  variant = "ghost",
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-xs"
          type="button"
          variant={variant}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function TodoBadges({ todo }: { todo: TodoItem }) {
  return (
    <div className="todo-inline-meta">
      {todo.todoKind === "notification" && (
        <Badge variant="outline">仅通知</Badge>
      )}
    </div>
  );
}

function TodoRow({
  onConfirm,
  onEdit,
  onRemove,
  onRun,
  onSelect,
  onToggle,
  selected,
  todo,
}: {
  onConfirm: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onRun: (todo: TodoItem) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  selected: boolean;
  todo: TodoItem;
}) {
  const readyError = todo.done ? null : validateReadyToExecute(todo.id);
  const executionStatus = todo.execution?.status;
  const isExecuting =
    executionStatus === "running" ||
    executionStatus === "waiting_input" ||
    executionStatus === "validating";
  const isPending = todo.reviewStatus === "pending_confirmation";
  const actionable = todo.todoKind !== "notification";

  return (
    <li
      className={cn("todo-item", todo.done && "done", selected && "active")}
      onClick={() => onSelect(todo.id)}
    >
      <div className="todo-check" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          aria-label={todo.done ? `恢复 ${todo.title}` : `完成 ${todo.title}`}
          checked={todo.done}
          onCheckedChange={() => onToggle(todo.id)}
        />
      </div>
      <div className="todo-content">
        <span className="todo-title">{todo.title}</span>
        <TodoBadges todo={todo} />
      </div>
      <div className="todo-actions" onClick={(event) => event.stopPropagation()}>
        {!todo.done && !isPending && actionable && (
          <IconButton
            disabled={readyError !== null || isExecuting}
            label={readyError ?? "一键执行"}
            onClick={() => onRun(todo)}
            variant="ghost"
          >
            <PlayIcon />
          </IconButton>
        )}
        {isPending && (
          <IconButton
            label={`确认 ${todo.title}`}
            onClick={() => onConfirm(todo.id)}
            variant="ghost"
          >
            <CheckCircleIcon />
          </IconButton>
        )}
        {!todo.done && (
          <IconButton
            label={`编辑 ${todo.title}`}
            onClick={() => onEdit(todo.id)}
            variant="ghost"
          >
            <PencilIcon />
          </IconButton>
        )}
        <IconButton
          label={`删除 ${todo.title}`}
          onClick={() => onRemove(todo.id)}
          variant="destructive"
        >
          <Trash2Icon />
        </IconButton>
      </div>
    </li>
  );
}

function TodoSection({
  emptyDescription,
  emptyTitle,
  items,
  onConfirm,
  onEdit,
  onRemove,
  onRun,
  onSelect,
  onToggle,
  selectedId,
  title,
  value,
}: TodoSectionProps) {
  return (
    <AccordionItem className="todo-section" value={value}>
      <AccordionTrigger className="section-heading section-toggle">
        <div className="section-heading-main">
          <h3>{title}</h3>
          <Badge className="section-count" variant="secondary">
            {items.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {items.length === 0 ? (
          <Empty className="empty-hint compact">
            <EmptyHeader>
              <EmptyTitle>{emptyTitle}</EmptyTitle>
              {emptyDescription && (
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              )}
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="todo-list">
            {items.map((todo) => (
              <TodoRow
                key={todo.id}
                onConfirm={onConfirm}
                onEdit={onEdit}
                onRemove={onRemove}
                onRun={onRun}
                onSelect={onSelect}
                onToggle={onToggle}
                selected={selectedId === todo.id}
                todo={todo}
              />
            ))}
          </ul>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export function TodoList() {
  const { todos, toggleTodo, removeTodo, confirmTodo } = useTodoStore();
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<TodoSectionKey[]>([
    "confirmed",
    "pending",
  ]);

  const grouped = useMemo(
    () => ({
      pending: todos.filter(
        (todo) => !todo.done && todo.reviewStatus === "pending_confirmation"
      ),
      confirmed: todos.filter(
        (todo) => !todo.done && todo.reviewStatus !== "pending_confirmation"
      ),
      done: todos.filter((todo) => todo.done),
    }),
    [todos]
  );
  const editingTodo = todos.find((todo) => todo.id === editingId);

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
      <Accordion
        type="multiple"
        value={expanded}
        onValueChange={(value) => setExpanded(value as TodoSectionKey[])}
      >
        <TodoSection
          emptyTitle="暂无已确认待办"
          items={grouped.confirmed}
          onConfirm={confirmTodo}
          onEdit={setEditingId}
          onRemove={removeTodo}
          onRun={runTodo}
          onSelect={setActiveTodo}
          onToggle={toggleTodo}
          selectedId={activeTodoId}
          title="已确认"
          value="confirmed"
        />
        <TodoSection
          emptyDescription="自动抓取的 todo 会先进入这里，确认后才进入已确认。"
          emptyTitle="暂无待确认事项"
          items={grouped.pending}
          onConfirm={confirmTodo}
          onEdit={setEditingId}
          onRemove={removeTodo}
          onRun={runTodo}
          onSelect={setActiveTodo}
          onToggle={toggleTodo}
          selectedId={activeTodoId}
          title="待确认"
          value="pending"
        />
        <TodoSection
          emptyTitle="暂无已完成事项"
          items={grouped.done}
          onConfirm={confirmTodo}
          onEdit={setEditingId}
          onRemove={removeTodo}
          onRun={runTodo}
          onSelect={setActiveTodo}
          onToggle={toggleTodo}
          selectedId={activeTodoId}
          title="已完成"
          value="done"
        />
      </Accordion>

      {editingTodo && (
        <TodoEditModal todo={editingTodo} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

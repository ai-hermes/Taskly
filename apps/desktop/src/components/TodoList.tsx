import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  CheckCircleIcon,
  GripVerticalIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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

const GROUP_KEYS: TodoSectionKey[] = ["confirmed", "pending", "done"];

const GROUP_META: Record<
  TodoSectionKey,
  { title: string; emptyTitle: string; emptyDescription?: string }
> = {
  confirmed: { title: "已确认", emptyTitle: "暂无已确认待办" },
  pending: {
    title: "待确认",
    emptyTitle: "暂无待确认事项",
    emptyDescription: "自动抓取的 todo 会先进入这里，确认后才进入已确认。",
  },
  done: { title: "已完成", emptyTitle: "暂无已完成事项" },
};

function groupOf(todo: TodoItem): TodoSectionKey {
  if (todo.done) return "done";
  if (todo.reviewStatus === "pending_confirmation") return "pending";
  return "confirmed";
}

type Containers = Record<TodoSectionKey, string[]>;

function deriveContainers(todos: TodoItem[]): Containers {
  const next: Containers = { confirmed: [], pending: [], done: [] };
  for (const todo of todos) next[groupOf(todo)].push(todo.id);
  return next;
}

/** Status patch applied when a todo is dragged into a different group. */
function statusPatch(
  group: TodoSectionKey,
  todo: TodoItem
): Partial<TodoItem> | null {
  if (groupOf(todo) === group) return null;
  if (group === "done") {
    return { done: true, completedBy: "manual" };
  }
  return {
    done: false,
    completedBy: undefined,
    reviewStatus: group === "pending" ? "pending_confirmation" : "confirmed",
  };
}

interface RowHandlers {
  onConfirm: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onRun: (todo: TodoItem) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
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

function TodoRowBody({
  dragHandle,
  handlers,
  selected,
  todo,
}: {
  dragHandle?: ReactNode;
  handlers: RowHandlers;
  selected: boolean;
  todo: TodoItem;
}) {
  const { onConfirm, onEdit, onRemove, onRun, onSelect, onToggle } = handlers;
  const readyError = todo.done ? null : validateReadyToExecute(todo.id);
  const executionStatus = todo.execution?.status;
  const isExecuting =
    executionStatus === "running" ||
    executionStatus === "waiting_input" ||
    executionStatus === "validating";
  const isPending = todo.reviewStatus === "pending_confirmation";
  const actionable = todo.todoKind !== "notification";

  return (
    <div
      className={cn("todo-item", todo.done && "done", selected && "active")}
      onClick={() => onSelect(todo.id)}
    >
      {dragHandle}
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
    </div>
  );
}

function SortableTodoRow({
  handlers,
  selected,
  todo,
}: {
  handlers: RowHandlers;
  selected: boolean;
  todo: TodoItem;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("todo-sortable", isDragging && "is-dragging")}
    >
      <TodoRowBody
        dragHandle={
          <button
            type="button"
            className="todo-drag-handle"
            aria-label={`拖拽 ${todo.title}`}
            onClick={(event) => event.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon />
          </button>
        }
        handlers={handlers}
        selected={selected}
        todo={todo}
      />
    </li>
  );
}

function TodoBranch({
  group,
  handlers,
  ids,
  selectedId,
  todoById,
}: {
  group: TodoSectionKey;
  handlers: RowHandlers;
  ids: string[];
  selectedId: string | null;
  todoById: Map<string, TodoItem>;
}) {
  const meta = GROUP_META[group];
  const { setNodeRef, isOver } = useDroppable({ id: group });

  return (
    <AccordionItem className="todo-section todo-tree-branch" value={group}>
      <AccordionTrigger className="section-heading section-toggle">
        <div className="section-heading-main">
          <h3>{meta.title}</h3>
          <Badge className="section-count" variant="secondary">
            {ids.length}
          </Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div
            ref={setNodeRef}
            className={cn("todo-drop-zone", isOver && "is-over")}
          >
            {ids.length === 0 ? (
              <Empty className="empty-hint compact">
                <EmptyHeader>
                  <EmptyTitle>{meta.emptyTitle}</EmptyTitle>
                  {meta.emptyDescription && (
                    <EmptyDescription>{meta.emptyDescription}</EmptyDescription>
                  )}
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="todo-list">
                {ids.map((id) => {
                  const todo = todoById.get(id);
                  if (!todo) return null;
                  return (
                    <SortableTodoRow
                      key={id}
                      handlers={handlers}
                      selected={selectedId === id}
                      todo={todo}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </SortableContext>
      </AccordionContent>
    </AccordionItem>
  );
}

export function TodoList() {
  const { todos, toggleTodo, removeTodo, confirmTodo, reorderTodos } =
    useTodoStore();
  const activeTodoId = useExecutionStore((s) => s.activeTodoId);
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<TodoSectionKey[]>([
    "confirmed",
    "pending",
  ]);
  const [containers, setContainers] = useState<Containers>(() =>
    deriveContainers(todos)
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const draggingRef = useRef(false);

  const todoById = useMemo(
    () => new Map(todos.map((todo) => [todo.id, todo])),
    [todos]
  );

  // Keep local drag containers in sync with the store when not dragging.
  useEffect(() => {
    if (draggingRef.current) return;
    setContainers(deriveContainers(todos));
  }, [todos]);

  const editingTodo = todos.find((todo) => todo.id === editingId);
  const activeTodo = activeId ? todoById.get(activeId) : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const findContainer = (id: string): TodoSectionKey | undefined => {
    if ((GROUP_KEYS as string[]).includes(id)) return id as TodoSectionKey;
    return GROUP_KEYS.find((key) => containers[key].includes(id));
  };

  const runTodo = async (todo: TodoItem) => {
    setActiveTodo(todo.id);
    try {
      await startInteractiveRun(todo.id);
    } catch {
      // Failure state is reflected in the store and console.
    }
  };

  const handlers: RowHandlers = {
    onConfirm: confirmTodo,
    onEdit: setEditingId,
    onRemove: removeTodo,
    onRun: runTodo,
    onSelect: setActiveTodo,
    onToggle: toggleTodo,
  };

  const commit = (next: Containers) => {
    const flat: TodoItem[] = [];
    for (const group of GROUP_KEYS) {
      for (const id of next[group]) {
        const todo = todoById.get(id);
        if (!todo) continue;
        const patch = statusPatch(group, todo);
        flat.push(
          patch
            ? { ...todo, ...patch, updatedAt: new Date().toISOString() }
            : todo
        );
      }
    }
    reorderTodos(flat);
  };

  const onDragStart = (event: DragStartEvent) => {
    draggingRef.current = true;
    setActiveId(String(event.active.id));
  };

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer
    ) {
      return;
    }
    setContainers((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const overIsContainer = (GROUP_KEYS as string[]).includes(
        String(over.id)
      );
      const overIndex = overIsContainer
        ? overItems.length
        : overItems.indexOf(String(over.id));
      const insertAt = overIndex >= 0 ? overIndex : overItems.length;
      return {
        ...prev,
        [activeContainer]: activeItems.filter((id) => id !== String(active.id)),
        [overContainer]: [
          ...overItems.slice(0, insertAt),
          String(active.id),
          ...overItems.slice(insertAt),
        ],
      };
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    draggingRef.current = false;
    setActiveId(null);
    if (!over) {
      setContainers(deriveContainers(todos));
      return;
    }
    const overContainer = findContainer(String(over.id));
    const activeContainer = findContainer(String(active.id));
    if (!overContainer || !activeContainer) {
      commit(containers);
      return;
    }
    const items = containers[overContainer];
    const oldIndex = items.indexOf(String(active.id));
    const overIsContainer = (GROUP_KEYS as string[]).includes(String(over.id));
    const newIndex = overIsContainer
      ? items.length - 1
      : items.indexOf(String(over.id));
    let next = containers;
    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      next = {
        ...containers,
        [overContainer]: arrayMove(items, oldIndex, newIndex),
      };
      setContainers(next);
    }
    commit(next);
  };

  const onDragCancel = () => {
    draggingRef.current = false;
    setActiveId(null);
    setContainers(deriveContainers(todos));
  };

  return (
    <div className="todo-list-container">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <Accordion
          type="multiple"
          value={expanded}
          onValueChange={(value) => setExpanded(value as TodoSectionKey[])}
        >
          {GROUP_KEYS.map((group) => (
            <TodoBranch
              key={group}
              group={group}
              handlers={handlers}
              ids={containers[group]}
              selectedId={activeTodoId}
              todoById={todoById}
            />
          ))}
        </Accordion>
        <DragOverlay>
          {activeTodo ? (
            <div className="todo-drag-overlay">
              <TodoRowBody
                dragHandle={
                  <span className="todo-drag-handle">
                    <GripVerticalIcon />
                  </span>
                }
                handlers={handlers}
                selected={activeTodoId === activeTodo.id}
                todo={activeTodo}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {editingTodo && (
        <TodoEditModal todo={editingTodo} onClose={() => setEditingId(null)} />
      )}
    </div>
  );
}

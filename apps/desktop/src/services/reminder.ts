import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { TodoItem } from "@/types";

const CHECK_INTERVAL_MS = 30_000;

async function ensurePermission(): Promise<boolean> {
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    return granted;
  } catch (err) {
    console.error("[Reminder] permission check failed:", err);
    return false;
  }
}

/**
 * Periodically checks pending todos and fires a system notification when a
 * todo's dueDate has arrived. Each todo is notified at most once; editing a
 * todo's dueDate back into the future re-arms its reminder.
 */
export class ReminderService {
  private intervalId: number | null = null;
  private permissionGranted = false;
  private notified: Set<string>;
  private getTodos: () => TodoItem[];
  private onNotifiedChange: (ids: string[]) => void;

  constructor(
    getTodos: () => TodoItem[],
    initialNotified: string[],
    onNotifiedChange: (ids: string[]) => void
  ) {
    this.getTodos = getTodos;
    this.notified = new Set(initialNotified);
    this.onNotifiedChange = onNotifiedChange;
  }

  async start() {
    if (this.intervalId) return;
    this.permissionGranted = await ensurePermission();
    if (!this.permissionGranted) {
      console.warn("[Reminder] notification permission not granted; reminders disabled");
    }
    this.pruneNotified();
    this.intervalId = window.setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.check();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Re-check permission (e.g. after the user grants it in system settings). */
  async refreshPermission() {
    this.permissionGranted = await ensurePermission();
    return this.permissionGranted;
  }

  private check() {
    const now = Date.now();
    let changed = false;

    for (const todo of this.getTodos()) {
      if (!todo.dueDate) continue;
      const due = new Date(todo.dueDate).getTime();
      if (Number.isNaN(due)) continue;

      const isNotified = this.notified.has(todo.id);

      // Re-arm a reminder that was pushed back into the future.
      if (due > now) {
        if (isNotified) {
          this.notified.delete(todo.id);
          changed = true;
        }
        continue;
      }

      // Due has passed.
      if (todo.done) continue; // don't remind about completed todos
      if (isNotified) continue;

      this.fire(todo);
      this.notified.add(todo.id);
      changed = true;
    }

    if (changed) this.onNotifiedChange([...this.notified]);
  }

  private fire(todo: TodoItem) {
    console.info("[Reminder] todo due: %s", todo.title);
    if (!this.permissionGranted) return;
    try {
      sendNotification({
        title: "待办到期提醒",
        body: todo.dueDate
          ? `${todo.title}（截止 ${formatDue(todo.dueDate)}）`
          : todo.title,
      });
    } catch (err) {
      console.error("[Reminder] failed to send notification:", err);
    }
  }

  /** Drop notified ids that no longer correspond to an existing todo. */
  private pruneNotified() {
    const ids = new Set(this.getTodos().map((t) => t.id));
    let changed = false;
    for (const id of this.notified) {
      if (!ids.has(id)) {
        this.notified.delete(id);
        changed = true;
      }
    }
    if (changed) this.onNotifiedChange([...this.notified]);
  }
}

function formatDue(dueDate: string): string {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return dueDate;
  return d.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

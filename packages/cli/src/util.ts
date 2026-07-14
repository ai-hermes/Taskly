import type { TodoItem } from "@taskly/core";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function wrap(code: number, s: string): string {
  return useColor ? `\u001b[${code}m${s}\u001b[0m` : s;
}
export const c = {
  dim: (s: string) => wrap(2, s),
  bold: (s: string) => wrap(1, s),
  green: (s: string) => wrap(32, s),
  yellow: (s: string) => wrap(33, s),
  red: (s: string) => wrap(31, s),
  cyan: (s: string) => wrap(36, s),
  gray: (s: string) => wrap(90, s),
};

export function shortId(id: string): string {
  return id.slice(0, 8);
}

const PRIORITY_LABEL = ["", "!", "!!", "!!!"];

export function priorityMark(p: number): string {
  const mark = PRIORITY_LABEL[Math.max(0, Math.min(3, p))] ?? "";
  return mark ? c.red(mark) : "";
}

/** Format a due date relative to now; empty string when no due date. */
export function formatDue(dueDate?: string): string {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return dueDate;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const dayMs = 24 * 60 * 60 * 1000;
  const iso = d.toISOString().slice(0, 16).replace("T", " ");
  if (diffMs < 0) return c.red(`${iso} (overdue)`);
  if (diffMs < dayMs) return c.yellow(`${iso} (soon)`);
  return c.dim(iso);
}

export function statusIcon(t: TodoItem): string {
  if (t.done) return c.green("✔");
  if (t.reviewStatus === "pending_confirmation") return c.yellow("?");
  return c.dim("○");
}

export function kindTag(t: TodoItem): string {
  return t.todoKind === "notification" ? c.cyan("[notify]") : c.gray("[action]");
}

/** One-line summary of a todo for list output. */
export function formatTodoLine(t: TodoItem): string {
  const parts = [
    statusIcon(t),
    c.gray(shortId(t.id)),
    kindTag(t),
    priorityMark(t.priority),
    t.title,
  ].filter(Boolean);
  const line = parts.join(" ");
  const due = formatDue(t.dueDate);
  return due ? `${line}  ${due}` : line;
}

export function formatTodoDetail(t: TodoItem): string {
  const lines = [
    `${statusIcon(t)} ${c.bold(t.title)}`,
    `${c.gray("id")}        ${t.id}`,
    `${c.gray("kind")}      ${t.todoKind ?? "actionable"}`,
    `${c.gray("priority")}  ${t.priority}`,
    `${c.gray("done")}      ${t.done}${t.completedBy ? ` (${t.completedBy})` : ""}`,
    `${c.gray("review")}    ${t.reviewStatus ?? "confirmed"}`,
  ];
  if (t.dueDate) lines.push(`${c.gray("due")}       ${t.dueDate}`);
  if (t.description) lines.push(`${c.gray("desc")}      ${t.description}`);
  if (t.source) lines.push(`${c.gray("source")}    ${t.source}`);
  lines.push(`${c.gray("created")}   ${t.createdAt}`);
  lines.push(`${c.gray("updated")}   ${t.updatedAt}`);
  return lines.join("\n");
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

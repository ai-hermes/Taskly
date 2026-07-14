import type { SyncPayload, TodoItem } from "@taskly/core";

/** Push local todos to the Taskly server. Returns the count the server accepted. */
export async function syncPush(
  serverUrl: string,
  todos: TodoItem[],
  deviceId: string
): Promise<number> {
  const payload: SyncPayload = { todos, timestamp: Date.now(), deviceId };
  const res = await fetch(`${trim(serverUrl)}/api/v1/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sync push failed: ${res.status} ${res.statusText}`);
  const data = (await res.json().catch(() => ({}))) as { synced?: number };
  return data.synced ?? todos.length;
}

/** Pull all todos from the Taskly server. */
export async function syncPull(serverUrl: string): Promise<TodoItem[]> {
  const res = await fetch(`${trim(serverUrl)}/api/v1/sync/pull`);
  if (!res.ok) throw new Error(`Sync pull failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as SyncPayload;
  return Array.isArray(data.todos) ? data.todos : [];
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}

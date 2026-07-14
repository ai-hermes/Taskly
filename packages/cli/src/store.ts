import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import type { TodoItem, Tombstone } from "@taskly/core";
import { fingerprint, makeTombstone, pruneTombstones } from "@taskly/core";
import { storePath } from "./paths.js";

export interface TodoStoreData {
  todos: TodoItem[];
  tombstones: Tombstone[];
  updatedAt: string;
}

const EMPTY: TodoStoreData = { todos: [], tombstones: [], updatedAt: new Date(0).toISOString() };

/** Tombstone retention window (7 days) to block re-detecting deleted todos. */
export const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

export function loadStore(): TodoStoreData {
  const path = storePath();
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TodoStoreData>;
    return {
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
      updatedAt: parsed.updatedAt ?? EMPTY.updatedAt,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveStore(data: TodoStoreData): void {
  data.updatedAt = new Date().toISOString();
  atomicWriteJson(storePath(), data);
}

/** Find a todo by id or unambiguous id-prefix. Returns index or -1. */
export function findTodoIndex(todos: TodoItem[], idOrPrefix: string): number {
  const exact = todos.findIndex((t) => t.id === idOrPrefix);
  if (exact >= 0) return exact;
  const matches = todos
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.id.startsWith(idOrPrefix));
  if (matches.length === 1) return matches[0].i;
  if (matches.length > 1) {
    throw new Error(`Ambiguous id prefix "${idOrPrefix}" matches ${matches.length} todos`);
  }
  return -1;
}

/** Ensure a todo has a fingerprint (for older/hand-written records). */
export function withFingerprint(todo: TodoItem): TodoItem {
  return todo.fingerprint ? todo : { ...todo, fingerprint: fingerprint(todo) };
}

/** Delete a todo by id, recording a tombstone. Returns the removed todo. */
export function deleteTodo(data: TodoStoreData, idOrPrefix: string): TodoItem {
  const idx = findTodoIndex(data.todos, idOrPrefix);
  if (idx < 0) throw new Error(`No todo found for "${idOrPrefix}"`);
  const [removed] = data.todos.splice(idx, 1);
  data.tombstones = pruneTombstones(
    [...data.tombstones, makeTombstone(removed)],
    TOMBSTONE_TTL_MS
  );
  return removed;
}

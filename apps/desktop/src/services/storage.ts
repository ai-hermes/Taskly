import { load } from "@tauri-apps/plugin-store";
import type {
  TodoItem,
  AppConfig,
  Tombstone,
  TranscriptEntry,
} from "@/types";

const STORE_PATH = "taskly-data.json";

let store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!store) {
    store = await load(STORE_PATH, { autoSave: true, defaults: {} });
  }
  return store;
}

export async function saveTodos(todos: TodoItem[]): Promise<void> {
  const s = await getStore();
  await s.set("todos", todos);
}

export async function loadTodos(): Promise<TodoItem[]> {
  const s = await getStore();
  const todos = await s.get<TodoItem[]>("todos");
  return todos || [];
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const s = await getStore();
  await s.set("config", config);
}

export async function loadConfig(): Promise<AppConfig | null> {
  const s = await getStore();
  return await s.get<AppConfig>("config") || null;
}

export async function saveTombstones(tombstones: Tombstone[]): Promise<void> {
  const s = await getStore();
  await s.set("tombstones", tombstones);
}

export async function loadTombstones(): Promise<Tombstone[]> {
  const s = await getStore();
  const tombstones = await s.get<Tombstone[]>("tombstones");
  return tombstones || [];
}

export async function saveNotifiedReminders(ids: string[]): Promise<void> {
  const s = await getStore();
  await s.set("notifiedReminders", ids);
}

export async function loadNotifiedReminders(): Promise<string[]> {
  const s = await getStore();
  const ids = await s.get<string[]>("notifiedReminders");
  return ids || [];
}

/** Persist the per-todo agent conversation history so it survives restarts. */
export async function saveChatTranscripts(
  transcripts: Record<string, TranscriptEntry[]>
): Promise<void> {
  const s = await getStore();
  // Drop empty entries to keep the file tidy.
  const pruned: Record<string, TranscriptEntry[]> = {};
  for (const [id, entries] of Object.entries(transcripts)) {
    if (entries && entries.length > 0) pruned[id] = entries;
  }
  await s.set("chatTranscripts", pruned);
}

export async function loadChatTranscripts(): Promise<
  Record<string, TranscriptEntry[]>
> {
  const s = await getStore();
  const data = await s.get<Record<string, TranscriptEntry[]>>(
    "chatTranscripts"
  );
  return data || {};
}

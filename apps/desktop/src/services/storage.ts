import { load } from "@tauri-apps/plugin-store";
import type { TodoItem, AppConfig } from "@/types";

const STORE_PATH = "taskly-data.json";

let store: Awaited<ReturnType<typeof load>> | null = null;

async function getStore() {
  if (!store) {
    store = await load(STORE_PATH, { autoSave: true });
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

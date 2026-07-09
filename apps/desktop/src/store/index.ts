import { create } from "zustand";
import type { TodoItem, AppConfig, Tombstone } from "@/types";
import { dedupTodos, makeTombstone, fingerprint } from "@/services/dedup";

interface TodoStore {
  todos: TodoItem[];
  tombstones: Tombstone[];
  addTodos: (items: TodoItem[], tombstoneTtlMs?: number) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  setTodos: (todos: TodoItem[]) => void;
  setTombstones: (tombstones: Tombstone[]) => void;
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  tombstones: [],
  addTodos: (items, tombstoneTtlMs = 0) =>
    set((state) => {
      const now = Date.now();
      const { added, liveTombstones } = dedupTodos(
        items,
        state.todos,
        state.tombstones,
        tombstoneTtlMs,
        now
      );
      if (added.length === 0 && liveTombstones.length === state.tombstones.length) {
        return {};
      }
      return {
        todos: added.length ? [...state.todos, ...added] : state.todos,
        tombstones: liveTombstones,
      };
    }),
  toggleTodo: (id) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id ? { ...t, done: !t.done, updatedAt: new Date().toISOString() } : t
      ),
    })),
  removeTodo: (id) =>
    set((state) => {
      const target = state.todos.find((t) => t.id === id);
      const tombstones = target
        ? [...state.tombstones, makeTombstone(target)]
        : state.tombstones;
      return {
        todos: state.todos.filter((t) => t.id !== id),
        tombstones,
      };
    }),
  updateTodo: (id, patch) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              // Recompute fingerprint when title/dueDate change.
              fingerprint: fingerprint({
                title: patch.title ?? t.title,
                dueDate: patch.dueDate ?? t.dueDate,
              }),
              updatedAt: new Date().toISOString(),
            }
          : t
      ),
    })),
  setTodos: (todos) =>
    set({
      todos: todos.map((t) => ({
        ...t,
        fingerprint: t.fingerprint || fingerprint(t),
      })),
    }),
  setTombstones: (tombstones) => set({ tombstones }),
}));

interface ConfigStore {
  config: AppConfig;
  updateConfig: (partial: Partial<AppConfig>) => void;
}

const defaultConfig: AppConfig = {
  whitelist: ["微信", "WeChat", "Weixin"],
  screenshotInterval: 30,
  llmProvider: "openai",
  llmConfig: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o-mini",
    },
  },
  syncEnabled: false,
  serverUrl: "http://localhost:8080",
  startupOpenMainWindow: false,
  debuggerConsoleEnabled: false,
  dedupTombstoneTtlMinutes: 30,
};

export const useConfigStore = create<ConfigStore>((set) => ({
  config: defaultConfig,
  updateConfig: (partial) =>
    set((state) => ({ config: { ...state.config, ...partial } })),
}));

interface AppState {
  monitoring: boolean;
  copilotVisible: boolean;
  lastOcrText: string;
  lastMonitorError: string;
  setMonitoring: (v: boolean) => void;
  setCopilotVisible: (v: boolean) => void;
  setLastOcrText: (text: string) => void;
  setLastMonitorError: (text: string) => void;
}

export const useAppState = create<AppState>((set) => ({
  monitoring: false,
  copilotVisible: true,
  lastOcrText: "",
  lastMonitorError: "",
  setMonitoring: (v) => set({ monitoring: v }),
  setCopilotVisible: (v) => set({ copilotVisible: v }),
  setLastOcrText: (text) => set({ lastOcrText: text }),
  setLastMonitorError: (text) => set({ lastMonitorError: text }),
}));

import { create } from "zustand";
import type { TodoItem, AppConfig } from "@/types";

interface TodoStore {
  todos: TodoItem[];
  addTodos: (items: TodoItem[]) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
  updateTodo: (id: string, patch: Partial<TodoItem>) => void;
  setTodos: (todos: TodoItem[]) => void;
}

export const useTodoStore = create<TodoStore>((set) => ({
  todos: [],
  addTodos: (items) =>
    set((state) => {
      // Deduplicate by title similarity
      const existing = new Set(state.todos.map((t) => t.title));
      const newItems = items.filter((item) => !existing.has(item.title));
      return { todos: [...state.todos, ...newItems] };
    }),
  toggleTodo: (id) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id ? { ...t, done: !t.done, updatedAt: new Date().toISOString() } : t
      ),
    })),
  removeTodo: (id) =>
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),
  updateTodo: (id, patch) =>
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === id
          ? { ...t, ...patch, updatedAt: new Date().toISOString() }
          : t
      ),
    })),
  setTodos: (todos) => set({ todos }),
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

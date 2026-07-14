import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { configPath, tasklyHome } from "./paths.js";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TasklyConfig {
  llm: LlmConfig;
  serverUrl: string;
  deviceId: string;
}

const DEFAULT_CONFIG: TasklyConfig = {
  llm: {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  },
  serverUrl: "http://127.0.0.1:8080",
  deviceId: "",
};

function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function randomDeviceId(): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  return g.crypto?.randomUUID?.() ?? `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Load config from disk (creating defaults + a stable deviceId on first run). */
export function loadRawConfig(): TasklyConfig {
  let cfg = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm } };
  const path = configPath();
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TasklyConfig>;
      cfg = {
        llm: { ...cfg.llm, ...(parsed.llm ?? {}) },
        serverUrl: parsed.serverUrl ?? cfg.serverUrl,
        deviceId: parsed.deviceId ?? cfg.deviceId,
      };
    } catch {
      // Corrupt config: fall back to defaults but don't overwrite silently.
    }
  }
  if (!cfg.deviceId) {
    cfg.deviceId = randomDeviceId();
    saveConfig(cfg);
  }
  return cfg;
}

/** Load config with environment-variable overrides applied (env wins). */
export function loadConfig(): TasklyConfig {
  const cfg = loadRawConfig();
  const env = process.env;
  return {
    llm: {
      baseUrl:
        env.TASKLY_LLM_BASE_URL?.trim() ||
        env.OPENAI_BASE_URL?.trim() ||
        cfg.llm.baseUrl,
      apiKey:
        env.TASKLY_LLM_API_KEY?.trim() ||
        env.OPENAI_API_KEY?.trim() ||
        cfg.llm.apiKey,
      model:
        env.TASKLY_LLM_MODEL?.trim() ||
        env.OPENAI_MODEL?.trim() ||
        cfg.llm.model,
    },
    serverUrl: env.TASKLY_SERVER_URL?.trim() || cfg.serverUrl,
    deviceId: cfg.deviceId,
  };
}

export function saveConfig(cfg: TasklyConfig): void {
  atomicWriteJson(configPath(), cfg);
}

/** Dotted-key setter used by `taskly config --set key=value`. */
export function setConfigKey(cfg: TasklyConfig, key: string, value: string): void {
  switch (key) {
    case "llm.baseUrl":
    case "baseUrl":
      cfg.llm.baseUrl = value;
      break;
    case "llm.apiKey":
    case "apiKey":
      cfg.llm.apiKey = value;
      break;
    case "llm.model":
    case "model":
      cfg.llm.model = value;
      break;
    case "serverUrl":
      cfg.serverUrl = value;
      break;
    default:
      throw new Error(
        `Unknown config key: ${key} (valid: llm.baseUrl, llm.apiKey, llm.model, serverUrl)`
      );
  }
}

export function redactedConfig(cfg: TasklyConfig): TasklyConfig {
  const key = cfg.llm.apiKey;
  const masked = key ? `${key.slice(0, 3)}***${key.slice(-2)}` : "";
  return {
    ...cfg,
    llm: { ...cfg.llm, apiKey: masked },
  };
}

export { tasklyHome };

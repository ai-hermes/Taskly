import { useState } from "react";
import { useAppState, useConfigStore, useTodoStore, useExecutionStore } from "@/store";
import { saveConfig } from "@/services/storage";
import { setDebuggerConsole } from "@/services/debugger";
import { listRunningApps, getActiveWindow } from "@/services/window";
import { FenceWizard } from "@/components/FenceWizard";
import type { AppConfig, FenceRect, TodoExecutionStatus } from "@/types";
import {
  X,
  Check,
  ArrowClockwise,
  Brain,
  Bug,
  CloudArrowUp,
  Crosshair,
  Lightning,
  Monitor,
  Pulse,
  Robot,
  RocketLaunch,
} from "@phosphor-icons/react";

type SettingsGroupId =
  | "status"
  | "monitor"
  | "model"
  | "agent"
  | "sync"
  | "startup"
  | "developer";

const SETTINGS_GROUPS: Array<{
  id: SettingsGroupId;
  label: string;
  icon: React.ReactNode;
}> = [
  { id: "status", label: "监控状态", icon: <Pulse size={16} /> },
  { id: "monitor", label: "监控设置", icon: <Monitor size={16} /> },
  { id: "model", label: "AI 模型", icon: <Brain size={16} /> },
  { id: "agent", label: "Agent 执行", icon: <Robot size={16} /> },
  { id: "sync", label: "同步", icon: <CloudArrowUp size={16} /> },
  { id: "startup", label: "启动行为", icon: <RocketLaunch size={16} /> },
  { id: "developer", label: "开发者选项", icon: <Bug size={16} /> },
];

const EXEC_STATUS_LABELS: Record<TodoExecutionStatus, string> = {
  idle: "空闲",
  workspace_ready: "工作区就绪",
  running: "执行中",
  waiting_input: "等待回复",
  validating: "校验中",
  needs_review: "待审阅",
  succeeded: "已完成",
  failed: "失败",
};

/** Live monitoring status: absorbs the former Taskly Copilot floating panel. */
function MonitorStatusSection({ onClose }: { onClose: () => void }) {
  const { monitoring, lastOcrText, lastMonitorError } = useAppState();
  const setActiveTodo = useExecutionStore((s) => s.setActiveTodo);
  const lastExecuted = useTodoStore((s) => {
    const withExec = s.todos.filter((t) => t.execution?.runId);
    if (withExec.length === 0) return undefined;
    return withExec.reduce((a, b) =>
      (a.execution!.startedAt ?? "") >= (b.execution!.startedAt ?? "") ? a : b
    );
  });

  return (
    <section className="settings-section">
      <h3>监控状态</h3>
      <div className="copilot-status">
        <span className={`status-dot ${monitoring ? "active" : "inactive"}`} />
        <span>{monitoring ? "监控中…" : "已暂停"}</span>
      </div>

      {lastExecuted?.execution && (
        <div
          className="copilot-exec-card"
          role="button"
          onClick={() => {
            setActiveTodo(lastExecuted.id);
            onClose();
          }}
          title="查看执行会话"
        >
          <h4>
            <Lightning size={13} weight="fill" />
            最近一次执行
          </h4>
          <p className="exec-card-title">{lastExecuted.title}</p>
          <p className={`exec-card-status ${lastExecuted.execution.status}`}>
            {lastExecuted.execution.runId} ·{" "}
            {EXEC_STATUS_LABELS[lastExecuted.execution.status] ??
              lastExecuted.execution.status}
          </p>
          {lastExecuted.execution.summary && (
            <p className="exec-card-summary">{lastExecuted.execution.summary}</p>
          )}
          {lastExecuted.execution.error && (
            <p className="exec-card-error">{lastExecuted.execution.error}</p>
          )}
        </div>
      )}

      <div className="copilot-ocr-preview">
        <h4>最近识别</h4>
        {lastOcrText ? (
          <p className="ocr-text">{lastOcrText.slice(0, 600)}</p>
        ) : (
          <p className="settings-status-empty">
            暂无识别记录。开始监控后，最近识别的聊天内容会显示在这里。
          </p>
        )}
      </div>

      {lastMonitorError && (
        <div className="copilot-ocr-preview">
          <h4>最近错误</h4>
          <p className="ocr-text">{lastMonitorError}</p>
        </div>
      )}
    </section>
  );
}

export function Settings({ onClose }: { onClose: () => void }) {
  const { config, updateConfig } = useConfigStore();
  const [activeGroup, setActiveGroup] = useState<SettingsGroupId>("status");
  const [local, setLocal] = useState<AppConfig>({ ...config });
  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loadingApps, setLoadingApps] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [fenceApp, setFenceApp] = useState<string | null>(null);
  const openaiConfig = local.llmConfig.openai || {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  };

  const handleSave = () => {
    // Prune fences for apps no longer in the whitelist.
    const fences = Object.fromEntries(
      Object.entries(local.captureFences ?? {}).filter(([app]) =>
        local.whitelist.includes(app)
      )
    );
    const next = { ...local, captureFences: fences };
    updateConfig(next);
    saveConfig(next).catch((err) => {
      console.error("Failed to save config:", err);
    });
    onClose();
  };

  const setFence = (app: string, fences: FenceRect[] | null) =>
    setLocal((prev) => {
      const all = { ...(prev.captureFences ?? {}) };
      if (fences && fences.length > 0) all[app] = fences;
      else delete all[app];
      return { ...prev, captureFences: all };
    });

  const handleDebuggerConsoleChange = (enabled: boolean) => {
    const nextConfig = { ...local, debuggerConsoleEnabled: enabled };
    setLocal(nextConfig);
    updateConfig({ debuggerConsoleEnabled: enabled });
    saveConfig(nextConfig).catch((err) => {
      console.error("Failed to save debugger console setting:", err);
    });
    setDebuggerConsole(enabled).catch((err) => {
      console.error("Failed to update debugger console:", err);
    });
  };

  const handleStartupOpenMainWindowChange = (enabled: boolean) => {
    const nextConfig = { ...local, startupOpenMainWindow: enabled };
    setLocal(nextConfig);
    updateConfig({ startupOpenMainWindow: enabled });
    saveConfig(nextConfig).catch((err) => {
      console.error("Failed to save startup window setting:", err);
    });
  };

  const setWhitelist = (next: string[]) => {
    const cleaned = Array.from(
      new Set(next.map((s) => s.trim()).filter(Boolean))
    );
    setLocal((prev) => ({ ...prev, whitelist: cleaned }));
  };

  const addApp = (name: string) => setWhitelist([...local.whitelist, name]);
  const removeApp = (name: string) =>
    setWhitelist(local.whitelist.filter((n) => n !== name));

  const loadRunningApps = async () => {
    setLoadingApps(true);
    setAppsError(null);
    try {
      setRunningApps(await listRunningApps());
    } catch (err) {
      console.error("Failed to list running apps:", err);
      setAppsError("获取运行中的应用失败，请确认已授予辅助功能权限。");
    } finally {
      setLoadingApps(false);
    }
  };

  const togglePicker = () => {
    const next = !showPicker;
    setShowPicker(next);
    if (next && runningApps.length === 0) {
      void loadRunningApps();
    }
  };

  const addCurrentApp = async () => {
    try {
      const name = (await getActiveWindow()).trim();
      if (name) addApp(name);
    } catch (err) {
      console.error("Failed to get active window:", err);
      setAppsError("获取当前前台应用失败。");
    }
  };

  const addManual = () => {
    const value = manualInput.trim();
    if (value) {
      addApp(value);
      setManualInput("");
    }
  };

  return (
    <div
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div className="settings-header">
        <div>
          <h2 id="settings-title">设置</h2>
          <p>配置监控、模型和同步选项。</p>
        </div>
        <button onClick={onClose} type="button" aria-label="关闭设置">
          <X size={18} />
        </button>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分组">
          {SETTINGS_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              className={`settings-nav-item${activeGroup === group.id ? " active" : ""}`}
              onClick={() => setActiveGroup(group.id)}
            >
              {group.icon}
              <span>{group.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {activeGroup === "status" && <MonitorStatusSection onClose={onClose} />}

          {activeGroup === "monitor" && (
        <section className="settings-section">
          <h3>监控设置</h3>
          <label className="field">
            <span>截图间隔</span>
            <input
              type="number"
              min={5}
              max={300}
              value={local.screenshotInterval}
              onChange={(e) =>
                setLocal({ ...local, screenshotInterval: Number(e.target.value) })
              }
            />
            <small>单位为秒，建议保持在 15 秒以上。</small>
          </label>
          <label className="field">
            <span>删除后拦截时长</span>
            <input
              type="number"
              min={0}
              max={1440}
              value={local.dedupTombstoneTtlMinutes}
              onChange={(e) =>
                setLocal({
                  ...local,
                  dedupTombstoneTtlMinutes: Math.max(0, Number(e.target.value)),
                })
              }
            />
            <small>
              单位为分钟。删除的待办在此时长内不会被重复识别加入；0 表示关闭该拦截。
            </small>
          </label>
          <label className="switch-field">
            <span>
              <strong>到期提醒</strong>
              <small>默认开启。待办到达截止时间时弹出系统通知。</small>
            </span>
            <input
              type="checkbox"
              checked={local.remindersEnabled}
              onChange={(e) => setLocal({ ...local, remindersEnabled: e.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          <div className="field">
            <span>白名单应用</span>
            <div className="whitelist-chips">
              {local.whitelist.length === 0 ? (
                <span className="whitelist-empty">
                  未添加应用，将使用默认（微信）
                </span>
              ) : (
                local.whitelist.map((name) => {
                  const fenceCount = local.captureFences?.[name]?.length ?? 0;
                  const hasFence = fenceCount > 0;
                  return (
                    <span className="whitelist-chip" key={name}>
                      {name}
                      <button
                        type="button"
                        className={`whitelist-chip-fence ${hasFence ? "active" : ""}`}
                        aria-label={`设置 ${name} 的抓取围栏`}
                        title={
                          hasFence
                            ? `已设置 ${fenceCount} 个抓取区域，点击修改`
                            : "设置抓取围栏"
                        }
                        onClick={() => setFenceApp(name)}
                      >
                        <Crosshair size={12} weight={hasFence ? "fill" : "regular"} />
                      </button>
                      <button
                        type="button"
                        className="whitelist-chip-remove"
                        aria-label={`移除 ${name}`}
                        onClick={() => removeApp(name)}
                      >
                        <X size={12} weight="bold" />
                      </button>
                    </span>
                  );
                })
              )}
            </div>
            <div className="whitelist-actions">
              <input
                type="text"
                placeholder="手动输入应用名，回车添加"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={togglePicker}
              >
                {showPicker ? "收起列表" : "选择运行中的应用"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={addCurrentApp}
              >
                添加当前前台应用
              </button>
            </div>
            {showPicker && (
              <div className="app-picker">
                <div className="app-picker-header">
                  <span>运行中的应用</span>
                  <button
                    type="button"
                    className="app-picker-refresh"
                    aria-label="刷新列表"
                    onClick={() => void loadRunningApps()}
                    disabled={loadingApps}
                  >
                    <ArrowClockwise size={14} />
                  </button>
                </div>
                {loadingApps ? (
                  <div className="app-picker-empty">正在获取运行中的应用…</div>
                ) : appsError ? (
                  <div className="app-picker-empty">{appsError}</div>
                ) : runningApps.length === 0 ? (
                  <div className="app-picker-empty">未获取到运行中的应用</div>
                ) : (
                  <div className="app-picker-list">
                    {runningApps.map((name) => {
                      const selected = local.whitelist.includes(name);
                      return (
                        <button
                          type="button"
                          key={name}
                          className={`app-picker-item${selected ? " selected" : ""}`}
                          onClick={() =>
                            selected ? removeApp(name) : addApp(name)
                          }
                        >
                          <span>{name}</span>
                          {selected && <Check size={14} weight="bold" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <small>仅当白名单应用在前台时才截图。可手动输入或从运行中的应用选择。</small>
          </div>
        </section>
          )}

          {activeGroup === "model" && (
        <section className="settings-section">
          <h3>AI 模型</h3>
          <label className="field">
            <span>Base URL</span>
            <input
              type="text"
              value={openaiConfig.baseUrl}
              onChange={(e) =>
                setLocal({
                  ...local,
                  llmConfig: {
                    ...local.llmConfig,
                    openai: {
                      ...openaiConfig,
                      baseUrl: e.target.value,
                    },
                  },
                })
              }
            />
            <small>兼容 OpenAI 接口，可填入自建/代理地址。</small>
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={openaiConfig.apiKey}
              onChange={(e) =>
                setLocal({
                  ...local,
                  llmConfig: {
                    ...local.llmConfig,
                    openai: {
                      ...openaiConfig,
                      apiKey: e.target.value,
                    },
                  },
                })
              }
            />
          </label>
          <label className="field">
            <span>模型</span>
            <input
              type="text"
              value={openaiConfig.model}
              onChange={(e) =>
                setLocal({
                  ...local,
                  llmConfig: {
                    ...local.llmConfig,
                    openai: {
                      ...openaiConfig,
                      model: e.target.value,
                    },
                  },
                })
              }
            />
            <small>用于 OCR 待办解析，同时作为内置 Agent 执行的模型凭据。</small>
          </label>
        </section>
          )}

          {activeGroup === "agent" && (
        <section className="settings-section">
          <h3>Agent 执行</h3>
          <label className="field">
            <span>Agent 命令</span>
            <input
              type="text"
              value={local.agentCommand}
              placeholder="留空使用内置 pi-coding-agent"
              onChange={(e) => setLocal({ ...local, agentCommand: e.target.value })}
            />
            <small>留空使用应用内置的 pi-coding-agent；高级用户可覆盖为自定义命令。</small>
          </label>
          <label className="field">
            <span>执行超时（秒）</span>
            <input
              type="number"
              min={30}
              value={local.agentTimeoutSec}
              onChange={(e) =>
                setLocal({
                  ...local,
                  agentTimeoutSec: Math.max(30, Number(e.target.value) || 600),
                })
              }
            />
          </label>
          <label className="field">
            <span>工作区根目录</span>
            <input
              type="text"
              value={local.workspaceBaseDir}
              placeholder="留空使用应用数据目录"
              onChange={(e) =>
                setLocal({ ...local, workspaceBaseDir: e.target.value })
              }
            />
            <small>每条待办的独立工作区将创建在该目录的 todo-workspaces/ 下。</small>
          </label>
        </section>
          )}

          {activeGroup === "sync" && (
        <section className="settings-section">
          <h3>同步设置</h3>
          <label className="switch-field">
            <span>
              <strong>启用云端同步</strong>
              <small>开启后会按服务器地址同步待办数据。</small>
            </span>
            <input
              type="checkbox"
              checked={local.syncEnabled}
              onChange={(e) =>
                setLocal({ ...local, syncEnabled: e.target.checked })
              }
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          {local.syncEnabled && (
            <label className="field">
              <span>服务器地址</span>
              <input
                type="text"
                value={local.serverUrl}
                onChange={(e) =>
                  setLocal({ ...local, serverUrl: e.target.value })
                }
              />
            </label>
          )}
        </section>
          )}

          {activeGroup === "startup" && (
        <section className="settings-section">
          <h3>启动行为</h3>
          <label className="switch-field">
            <span>
              <strong>启动时打开主界面</strong>
              <small>默认关闭。关闭后 Taskly 会启动到后台，可从托盘打开。</small>
            </span>
            <input
              type="checkbox"
              checked={local.startupOpenMainWindow}
              onChange={(e) => handleStartupOpenMainWindowChange(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </section>
          )}

          {activeGroup === "developer" && (
        <section className="settings-section">
          <h3>开发者选项</h3>
          <label className="switch-field">
            <span>
              <strong>调试控制台</strong>
              <small>默认关闭。开启后会显示当前窗口的 DevTools。</small>
            </span>
            <input
              type="checkbox"
              checked={local.debuggerConsoleEnabled}
              onChange={(e) => handleDebuggerConsoleChange(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
        </section>
          )}
        </div>
      </div>

      <div className="settings-footer">
        <button className="btn-secondary" onClick={onClose}>
          取消
        </button>
        <button className="btn-primary" onClick={handleSave}>
          保存设置
        </button>
      </div>
      {fenceApp && (
        <FenceWizard
          appName={fenceApp}
          fences={local.captureFences?.[fenceApp]}
          onSave={(rects) => setFence(fenceApp, rects)}
          onClear={() => setFence(fenceApp, null)}
          onClose={() => setFenceApp(null)}
        />
      )}
    </div>
  );
}

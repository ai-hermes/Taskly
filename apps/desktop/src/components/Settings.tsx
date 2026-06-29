import { useState } from "react";
import { useConfigStore } from "@/store";
import { saveConfig } from "@/services/storage";
import { setDebuggerConsole } from "@/services/debugger";
import type { AppConfig } from "@/types";
import { X } from "@phosphor-icons/react";

export function Settings({ onClose }: { onClose: () => void }) {
  const { config, updateConfig } = useConfigStore();
  const [local, setLocal] = useState<AppConfig>({ ...config });
  const openaiConfig = local.llmConfig.openai || {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
  };
  const ollamaConfig = local.llmConfig.ollama || {
    baseUrl: "http://localhost:11434",
    apiKey: "",
    model: "qwen2.5:7b",
  };

  const handleSave = () => {
    updateConfig(local);
    saveConfig(local).catch((err) => {
      console.error("Failed to save config:", err);
    });
    onClose();
  };

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

      <div className="settings-body">
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
            <span>白名单应用</span>
            <input
              type="text"
              value={local.whitelist.join(", ")}
              onChange={(e) =>
                setLocal({
                  ...local,
                  whitelist: e.target.value.split(",").map((s) => s.trim()),
                })
              }
            />
            <small>使用英文逗号分隔应用名，仅前台匹配时截图。</small>
          </label>
        </section>

        <section className="settings-section">
          <h3>AI 模型</h3>
          <div className="field">
            <span>Provider</span>
            <div className="segmented-control" role="group" aria-label="AI Provider">
              <button
                type="button"
                className={local.llmProvider === "ollama" ? "selected" : ""}
                aria-pressed={local.llmProvider === "ollama"}
                onClick={() =>
                  setLocal({
                    ...local,
                    llmProvider: "ollama",
                  })
                }
              >
                Ollama
              </button>
              <button
                type="button"
                className={local.llmProvider === "openai" ? "selected" : ""}
                aria-pressed={local.llmProvider === "openai"}
                onClick={() =>
                  setLocal({
                    ...local,
                    llmProvider: "openai",
                  })
                }
              >
                OpenAI
              </button>
            </div>
            <small>本地优先使用 Ollama，需要云端模型时切换 OpenAI。</small>
          </div>

          {local.llmProvider === "openai" && (
            <>
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
              </label>
            </>
          )}

          {local.llmProvider === "ollama" && (
            <>
              <label className="field">
                <span>Ollama 地址</span>
                <input
                  type="text"
                  value={ollamaConfig.baseUrl}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      llmConfig: {
                        ...local.llmConfig,
                        ollama: {
                          ...ollamaConfig,
                          baseUrl: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>模型名称</span>
                <input
                  type="text"
                  value={ollamaConfig.model}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      llmConfig: {
                        ...local.llmConfig,
                        ollama: {
                          ...ollamaConfig,
                          model: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
              <label className="field">
                <span>API Key</span>
                <input
                  type="password"
                  value={ollamaConfig.apiKey}
                  onChange={(e) =>
                    setLocal({
                      ...local,
                      llmConfig: {
                        ...local.llmConfig,
                        ollama: {
                          ...ollamaConfig,
                          apiKey: e.target.value,
                        },
                      },
                    })
                  }
                />
              </label>
            </>
          )}
        </section>

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
      </div>

      <div className="settings-footer">
        <button className="btn-secondary" onClick={onClose}>
          取消
        </button>
        <button className="btn-primary" onClick={handleSave}>
          保存设置
        </button>
      </div>
    </div>
  );
}

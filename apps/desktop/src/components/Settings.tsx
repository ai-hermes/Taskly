import { useState } from "react";
import { useConfigStore } from "@/store";
import type { AppConfig } from "@/types";

export function Settings({ onClose }: { onClose: () => void }) {
  const { config, updateConfig } = useConfigStore();
  const [local, setLocal] = useState<AppConfig>({ ...config });
  const openaiConfig = local.llmConfig.openai || { apiKey: "", model: "gpt-4o-mini" };
  const ollamaConfig = local.llmConfig.ollama || {
    baseUrl: "http://localhost:11434",
    model: "qwen2.5:7b",
  };

  const handleSave = () => {
    updateConfig(local);
    onClose();
  };

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>⚙️ 设置</h2>
        <button onClick={onClose}>✕</button>
      </div>

      <div className="settings-body">
        <section className="settings-section">
          <h3>监控设置</h3>
          <label>
            截图间隔（秒）
            <input
              type="number"
              min={5}
              max={300}
              value={local.screenshotInterval}
              onChange={(e) =>
                setLocal({ ...local, screenshotInterval: Number(e.target.value) })
              }
            />
          </label>
          <label>
            白名单应用（逗号分隔）
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
          </label>
        </section>

        <section className="settings-section">
          <h3>AI 模型</h3>
          <label>
            Provider
            <select
              value={local.llmProvider}
              onChange={(e) =>
                setLocal({
                  ...local,
                  llmProvider: e.target.value as "openai" | "ollama",
                })
              }
            >
              <option value="ollama">Ollama (本地)</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>

          {local.llmProvider === "openai" && (
            <>
              <label>
                API Key
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
              <label>
                模型
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
              <label>
                Ollama 地址
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
              <label>
                模型名称
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
            </>
          )}
        </section>

        <section className="settings-section">
          <h3>同步设置</h3>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={local.syncEnabled}
              onChange={(e) =>
                setLocal({ ...local, syncEnabled: e.target.checked })
              }
            />
            启用云端同步
          </label>
          {local.syncEnabled && (
            <label>
              服务器地址
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
      </div>

      <div className="settings-footer">
        <button className="btn-secondary" onClick={onClose}>
          取消
        </button>
        <button className="btn-primary" onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import {
  ActivityIcon,
  BotIcon,
  BrainIcon,
  BugIcon,
  CheckIcon,
  CloudUploadIcon,
  CrosshairIcon,
  MonitorIcon,
  RefreshCwIcon,
  RocketIcon,
  SparklesIcon,
  ZapIcon,
  XIcon,
} from "lucide-react";
import { setDebuggerConsole } from "@/services/debugger";
import { saveConfig } from "@/services/storage";
import { getActiveWindow, listRunningApps } from "@/services/window";
import {
  useAppState,
  useConfigStore,
  useExecutionStore,
  useTodoStore,
} from "@/store";
import type { AppConfig, FenceRect, TodoExecutionStatus } from "@/types";
import { FenceWizard } from "@/components/FenceWizard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  icon: ReactNode;
}> = [
  { id: "status", label: "监控状态", icon: <ActivityIcon data-icon="inline-start" /> },
  { id: "monitor", label: "监控设置", icon: <MonitorIcon data-icon="inline-start" /> },
  { id: "model", label: "AI 模型", icon: <BrainIcon data-icon="inline-start" /> },
  { id: "agent", label: "Agent 执行", icon: <BotIcon data-icon="inline-start" /> },
  { id: "sync", label: "同步", icon: <CloudUploadIcon data-icon="inline-start" /> },
  { id: "startup", label: "启动行为", icon: <RocketIcon data-icon="inline-start" /> },
  { id: "developer", label: "开发者选项", icon: <BugIcon data-icon="inline-start" /> },
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

function SettingsSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-heading">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <FieldGroup>{children}</FieldGroup>
    </section>
  );
}

function TextSetting({
  description,
  id,
  min,
  max,
  onChange,
  placeholder,
  title,
  type = "text",
  value,
}: {
  description?: string;
  id: string;
  min?: number;
  max?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  title: string;
  type?: "number" | "password" | "text";
  value: number | string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{title}</FieldLabel>
      <Input
        id={id}
        type={type}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function SwitchSetting({
  checked,
  description,
  id,
  onCheckedChange,
  title,
}: {
  checked: boolean;
  description: string;
  id: string;
  onCheckedChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{title}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  );
}

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
    <SettingsSection
      title="监控状态"
      description="查看截图监控、最近识别和 Agent 执行结果。"
    >
      <div className="settings-status-grid">
        <div className="settings-status-card settings-status-card-primary">
          <div className="settings-status-card-head">
            <span className={`status-dot ${monitoring ? "active" : "inactive"}`} />
            <span>当前状态</span>
          </div>
          <strong>{monitoring ? "监控中" : "已暂停"}</strong>
          <p>最近识别与执行状态会显示在这里。</p>
        </div>

        {lastExecuted?.execution ? (
          <button
            type="button"
            className="settings-status-card settings-exec-card"
            onClick={() => {
              setActiveTodo(lastExecuted.id);
              onClose();
            }}
          >
            <div className="settings-status-card-head">
              <ZapIcon data-icon="inline-start" />
              <span>最近一次执行</span>
            </div>
            <strong>{lastExecuted.title}</strong>
            <div className="settings-exec-meta">
              <Badge variant="secondary">{lastExecuted.execution.runId}</Badge>
              <Badge variant="outline">
                {EXEC_STATUS_LABELS[lastExecuted.execution.status] ??
                  lastExecuted.execution.status}
              </Badge>
            </div>
            {lastExecuted.execution.summary && (
              <p className="exec-card-summary">{lastExecuted.execution.summary}</p>
            )}
            {lastExecuted.execution.error && (
              <Alert variant="destructive" className="settings-inline-alert">
                <AlertDescription>
                  {lastExecuted.execution.error}
                </AlertDescription>
              </Alert>
            )}
          </button>
        ) : (
          <div className="settings-status-card settings-muted-card">
            <div className="settings-status-card-head">
              <ZapIcon data-icon="inline-start" />
              <span>最近一次执行</span>
            </div>
            <strong>暂无执行记录</strong>
            <p>执行待办后，可从这里快速回到对应任务。</p>
          </div>
        )}

        <div className="settings-status-card settings-ocr-card">
          <div className="settings-status-card-head">
            <ActivityIcon data-icon="inline-start" />
            <span>最近识别</span>
          </div>
          {lastOcrText ? (
            <p className="ocr-text">{lastOcrText.slice(0, 600)}</p>
          ) : (
            <Empty className="settings-status-empty">
              <EmptyHeader>
                <EmptyTitle>暂无识别记录</EmptyTitle>
                <EmptyDescription>
                  开始监控后，最近识别的聊天内容会显示在这里。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
      {lastMonitorError && (
        <Alert variant="destructive" className="settings-inline-alert">
          <AlertDescription>{lastMonitorError}</AlertDescription>
        </Alert>
      )}
    </SettingsSection>
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

  const updateOpenaiConfig = (
    key: keyof typeof openaiConfig,
    value: string
  ) => {
    setLocal({
      ...local,
      llmConfig: {
        ...local.llmConfig,
        openai: {
          ...openaiConfig,
          [key]: value,
        },
      },
    });
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
    <>
      <section
        className="settings-panel"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <h2 id="settings-title">设置</h2>
            <p>配置监控、模型和同步选项。</p>
          </div>
        </header>

        <Tabs
          value={activeGroup}
          onValueChange={(value) => setActiveGroup(value as SettingsGroupId)}
          orientation="vertical"
          className="settings-layout"
        >
          <TabsList
            className="settings-nav"
            variant="line"
            aria-label="设置分组"
          >
            {SETTINGS_GROUPS.map((group) => (
              <TabsTrigger
                key={group.id}
                className="settings-nav-item"
                value={group.id}
              >
                {group.icon}
                <span>{group.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <ScrollArea className="settings-body">
            <TabsContent value="status">
              <MonitorStatusSection onClose={onClose} />
            </TabsContent>

            <TabsContent value="monitor">
                <SettingsSection
                  title="基础参数"
                  description="控制截图频率和删除后的重复识别拦截。"
                >
                  <TextSetting
                    id="screenshot-interval"
                    title="截图间隔"
                    type="number"
                    min={5}
                    max={300}
                    value={local.screenshotInterval}
                    onChange={(value) =>
                      setLocal({
                        ...local,
                        screenshotInterval: Number(value),
                      })
                    }
                    description="单位为秒，建议保持在 15 秒以上。"
                  />
                  <TextSetting
                    id="dedup-ttl"
                    title="删除后拦截时长"
                    type="number"
                    min={0}
                    max={1440}
                    value={local.dedupTombstoneTtlMinutes}
                    onChange={(value) =>
                      setLocal({
                        ...local,
                        dedupTombstoneTtlMinutes: Math.max(0, Number(value)),
                      })
                    }
                    description="单位为分钟。删除的待办在此时长内不会被重复识别加入；0 表示关闭该拦截。"
                  />
                </SettingsSection>

                <SettingsSection
                  title="提醒"
                  description="控制待办到期时的系统通知。"
                >
                  <SwitchSetting
                    id="reminders-enabled"
                    title="到期提醒"
                    description="默认开启。待办到达截止时间时弹出系统通知。"
                    checked={local.remindersEnabled}
                    onCheckedChange={(checked) =>
                      setLocal({ ...local, remindersEnabled: checked })
                    }
                  />
                </SettingsSection>

                <SettingsSection
                  title="白名单应用"
                  description="仅当前台应用命中白名单时截图，可为单个应用设置抓取围栏。"
                >
                  <Field>
                    <FieldLabel>白名单应用</FieldLabel>
                    <div className="whitelist-chips">
                      {local.whitelist.length === 0 ? (
                        <Badge variant="outline">未添加应用，将使用默认（微信）</Badge>
                      ) : (
                        local.whitelist.map((name) => {
                          const fenceCount =
                            local.captureFences?.[name]?.length ?? 0;
                          const hasFence = fenceCount > 0;
                          return (
                            <Badge
                              className="whitelist-chip"
                              key={name}
                              variant={hasFence ? "secondary" : "outline"}
                            >
                              <span className="whitelist-chip-name">{name}</span>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`设置 ${name} 的抓取围栏`}
                                title={
                                  hasFence
                                    ? `已设置 ${fenceCount} 个抓取区域，点击修改`
                                    : "设置抓取围栏"
                                }
                                onClick={() => setFenceApp(name)}
                              >
                                <CrosshairIcon />
                              </Button>
                              <Button
                                type="button"
                                size="icon-xs"
                                variant="ghost"
                                aria-label={`移除 ${name}`}
                                onClick={() => removeApp(name)}
                              >
                                <XIcon />
                              </Button>
                            </Badge>
                          );
                        })
                      )}
                    </div>
                    <InputGroup>
                      <InputGroupInput
                        placeholder="手动输入应用名，回车添加"
                        value={manualInput}
                        onChange={(event) => setManualInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addManual();
                          }
                        }}
                      />
                      <InputGroupAddon align="inline-end">
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={addManual}
                        >
                          添加
                        </Button>
                      </InputGroupAddon>
                    </InputGroup>
                    <div className="whitelist-actions">
                      <Button type="button" variant="outline" onClick={togglePicker}>
                        {showPicker ? "收起列表" : "选择运行中的应用"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={addCurrentApp}
                      >
                        添加当前前台应用
                      </Button>
                    </div>
                    {showPicker && (
                      <Card className="app-picker">
                        <CardHeader className="app-picker-header">
                          <CardTitle>运行中的应用</CardTitle>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="刷新列表"
                            onClick={() => void loadRunningApps()}
                            disabled={loadingApps}
                          >
                            <RefreshCwIcon />
                          </Button>
                        </CardHeader>
                        <CardContent>
                          {loadingApps ? (
                            <div className="flex flex-col gap-2">
                              <Skeleton className="h-7 w-full" />
                              <Skeleton className="h-7 w-4/5" />
                            </div>
                          ) : appsError ? (
                            <Alert variant="destructive">
                              <AlertDescription>{appsError}</AlertDescription>
                            </Alert>
                          ) : runningApps.length === 0 ? (
                            <Empty className="app-picker-empty">
                              <EmptyHeader>
                                <EmptyTitle>未获取到运行中的应用</EmptyTitle>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <div className="app-picker-list">
                              {runningApps.map((name) => {
                                const selected = local.whitelist.includes(name);
                                return (
                                  <Button
                                    type="button"
                                    key={name}
                                    variant={selected ? "secondary" : "ghost"}
                                    className="app-picker-item justify-between"
                                    onClick={() =>
                                      selected ? removeApp(name) : addApp(name)
                                    }
                                  >
                                    <span>{name}</span>
                                    {selected && <CheckIcon data-icon="inline-end" />}
                                  </Button>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    )}
                    <FieldDescription>
                      仅当白名单应用在前台时才截图。可手动输入或从运行中的应用选择。
                    </FieldDescription>
                  </Field>
                </SettingsSection>
            </TabsContent>

            <TabsContent value="model">
                <SettingsSection
                  title="AI 模型"
                  description="配置兼容 OpenAI 接口的模型凭据。"
                >
                  <TextSetting
                    id="base-url"
                    title="Base URL"
                    value={openaiConfig.baseUrl}
                    onChange={(value) => updateOpenaiConfig("baseUrl", value)}
                    description="兼容 OpenAI 接口，可填入自建/代理地址。"
                  />
                  <TextSetting
                    id="api-key"
                    title="API Key"
                    type="password"
                    value={openaiConfig.apiKey}
                    onChange={(value) => updateOpenaiConfig("apiKey", value)}
                  />
                  <TextSetting
                    id="model"
                    title="模型"
                    value={openaiConfig.model}
                    onChange={(value) => updateOpenaiConfig("model", value)}
                    description="用于 OCR 待办解析，同时作为内置 Agent 执行的模型凭据。"
                  />
                </SettingsSection>
            </TabsContent>

            <TabsContent value="agent">
                <SettingsSection
                  title="Agent 执行"
                  description="控制内置 Agent 的命令、超时和工作区位置。"
                >
                  <TextSetting
                    id="agent-command"
                    title="Agent 命令"
                    value={local.agentCommand}
                    placeholder="留空使用内置 pi-coding-agent"
                    onChange={(value) =>
                      setLocal({ ...local, agentCommand: value })
                    }
                    description="留空使用应用内置的 pi-coding-agent；高级用户可覆盖为自定义命令。"
                  />
                  <TextSetting
                    id="agent-timeout"
                    title="执行超时（秒）"
                    type="number"
                    min={30}
                    value={local.agentTimeoutSec}
                    onChange={(value) =>
                      setLocal({
                        ...local,
                        agentTimeoutSec: Math.max(30, Number(value) || 600),
                      })
                    }
                  />
                  <TextSetting
                    id="workspace-base-dir"
                    title="工作区根目录"
                    value={local.workspaceBaseDir}
                    placeholder="留空使用应用数据目录"
                    onChange={(value) =>
                      setLocal({ ...local, workspaceBaseDir: value })
                    }
                    description="每条待办的独立工作区将创建在该目录的 todo-workspaces/ 下。"
                  />
                </SettingsSection>
            </TabsContent>

            <TabsContent value="sync">
                <SettingsSection
                  title="同步设置"
                  description="开启后按服务器地址同步待办数据。"
                >
                  <SwitchSetting
                    id="sync-enabled"
                    title="启用云端同步"
                    description="开启后会按服务器地址同步待办数据。"
                    checked={local.syncEnabled}
                    onCheckedChange={(checked) =>
                      setLocal({ ...local, syncEnabled: checked })
                    }
                  />
                  {local.syncEnabled && (
                    <TextSetting
                      id="server-url"
                      title="服务器地址"
                      value={local.serverUrl}
                      onChange={(value) =>
                        setLocal({ ...local, serverUrl: value })
                      }
                    />
                  )}
                </SettingsSection>
            </TabsContent>

            <TabsContent value="startup">
                <SettingsSection
                  title="启动行为"
                  description="控制 Taskly 启动后是否直接打开主界面。"
                >
                  <SwitchSetting
                    id="startup-open-main-window"
                    title="启动时打开主界面"
                    description="默认关闭。关闭后 Taskly 会启动到后台，可从托盘打开。"
                    checked={local.startupOpenMainWindow}
                    onCheckedChange={handleStartupOpenMainWindowChange}
                  />
                </SettingsSection>
            </TabsContent>

            <TabsContent value="developer">
                <SettingsSection
                  title="开发者选项"
                  description="面向调试和开发排查的本地选项。"
                >
                  <SwitchSetting
                    id="debugger-console"
                    title="调试控制台"
                    description="默认关闭。开启后会显示当前窗口的 DevTools。"
                    checked={local.debuggerConsoleEnabled}
                    onCheckedChange={handleDebuggerConsoleChange}
                  />
                </SettingsSection>
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <footer className="settings-footer">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" onClick={handleSave}>
            <SparklesIcon data-icon="inline-start" />
            保存设置
          </Button>
        </footer>
      </section>

      {fenceApp && (
        <FenceWizard
          appName={fenceApp}
          fences={local.captureFences?.[fenceApp]}
          onSave={(rects) => setFence(fenceApp, rects)}
          onClear={() => setFence(fenceApp, null)}
          onClose={() => setFenceApp(null)}
        />
      )}
    </>
  );
}

# Taskly

智能待办识别与管理工具 —— 通过桌面截图 + OCR 自动识别聊天中的待办事项。

## 功能特性

- 🖥️ **智能截图** - 监控白名单应用（微信），自动截图
- 🔍 **本地 OCR** - ocr-rs 本地识别，数据不出设备
- 🤖 **AI 提取** - 大模型从聊天文本中提取结构化待办
- 🔔 **到期提醒** - 待办到点自动弹出系统通知，不错过截止时间
- 💬 **桌面 Copilot** - 悬浮助手窗口，实时显示识别状态
- ☁️ **云端同步** - 远端集中管理，多设备同步

## 技术架构

| 模块 | 技术栈 |
|------|--------|
| 桌面端 | Tauri 2.x + React + TypeScript |
| 本地 OCR | rust-paddle-ocr + MNN runtime |
| 大模型 | OpenAI 兼容接口 |
| 后端 | Go + Gin + PostgreSQL |

## 项目结构

```
Taskly/
├── apps/
│   ├── desktop/          # Tauri 桌面应用
│   │   └── src-tauri/models/ # OCR runtime models
│   ├── server/           # Go 后端服务
│   └── ocr-sidecar/      # 独立本地 OCR 二进制（供 CLI --image 使用，可选）
├── packages/
│   ├── core/             # 共享核心：待办模型 + LLM 提取 + 去重（desktop & CLI 复用）
│   └── cli/              # taskly 命令行（对接 codex）
├── skills/taskly/        # codex skill（教 codex 调用 taskly CLI）
└── docs/                 # 文档
```

## 开发

### 前置要求

- Node.js >= 18
- pnpm >= 8
- Rust (latest stable)
- Go >= 1.21

### 快速开始

```bash
# 安装依赖
pnpm install

# 启动桌面应用（开发模式）
pnpm dev

# 启动后端服务
pnpm dev:server
```

> 提示：大模型使用 OpenAI 兼容接口，需在设置中填入 Base URL、API Key 与模型名；并且 macOS 需要给 Taskly 授予「屏幕录制」与「辅助功能」权限，否则无法截图/识别。

OCR 使用内置 Rust 命令直接调用 `ocr-rs`，模型文件位于 `apps/desktop/src-tauri/models/`，不需要构建 Python sidecar。

### 内置 pi-coding-agent（一键完成待办）

待办的「一键执行」依赖内置的 `pi-coding-agent` sidecar 二进制。首次开发或打包前需构建一次（要求本机安装 [bun](https://bun.sh)）：

```bash
cd apps/desktop
pnpm build:sidecar
```

产物输出到 `apps/desktop/src-tauri/binaries/pi-coding-agent-{target-triple}`（已 gitignore），打包时经 `tauri.conf.json` 的 `externalBin` 随应用分发。高级用户可在设置中覆盖为自定义 agent 命令。

## Taskly CLI（对接 codex）

`taskly` 命令行把 Taskly 的核心能力（LLM 提取结构化待办、待办管理、到期提醒、云端同步）搬到终端，并配套一个 [codex](https://github.com/openai/codex) skill —— 让 codex 在对话里直接帮用户捕获、管理待办，并亲自执行 actionable 待办。数据默认存本地 `~/.taskly/todos.json`，与桌面 app 共享同一套模型与同步协议。

### 构建

```bash
pnpm install
pnpm --filter @taskly/core build   # 共享核心
pnpm --filter @taskly/cli build    # 生成 packages/cli/dist/index.js（bin: taskly）
# 或一次性：
pnpm build:cli
```

本地联调可 `node packages/cli/dist/index.js <cmd>`，或 `pnpm --filter @taskly/cli link --global` 后直接 `taskly`。

### 配置

`extract` 需要 OpenAI 兼容的大模型，按优先级读取：`TASKLY_LLM_API_KEY` → `OPENAI_API_KEY` → 保存的配置（base URL / model 同理）。

```bash
taskly config --set llm.apiKey=sk-... llm.model=gpt-4o-mini
taskly config            # 查看当前配置（api key 已脱敏）
```

### 常用命令

```bash
# 从聊天文本提取待办并入库（自动去重）
echo "老板说周五前把设计稿交给张三，团队会议改到下午3点" | taskly extract --save --json

taskly add "写周报" --due 2026-07-15 --priority 2
taskly list                       # 未完成待办
taskly done <id> --by agent       # 完成（agent 执行时用 --by agent）
taskly due --within 72 --notify   # 72 小时内到期项并弹系统通知
taskly sync push                  # 推送到 Go server（本地优先，可选）
taskly extract --image shot.png   # 本地 OCR 识别图片（需 taskly-ocr sidecar）
```

所有读写命令支持 `--json`，便于 codex 等程序化串联。

### 安装 codex skill

```bash
taskly skill install              # 复制 skills/taskly 到 ~/.codex/skills/taskly
taskly skill install --force      # 覆盖更新
```

skill 教 codex 何时调用 `taskly`：从对话里提取待办、管理、提醒；对 `actionable` 待办由 codex 亲自执行，完成后 `taskly done <id> --by agent` 回写。

### 本地 OCR sidecar（可选）

`taskly extract --image` 依赖独立的 `taskly-ocr` 二进制（复用 `ocr-rs`，与桌面端同引擎）：

```bash
cd apps/ocr-sidecar
cargo build --release             # 产物 target/release/taskly-ocr
export TASKLY_OCR_BIN=$(pwd)/target/release/taskly-ocr
```

未安装时 `--image` 会报错并提示改用文本输入；纯文本提取无需该二进制。

## 隐私说明

- 截图数据仅在本地处理，不上传服务器
- OCR 识别完全在本地运行
- 仅在白名单应用前台时工作
- 用户可随时暂停/关闭监控

## License

MIT

# Taskly

智能待办识别与管理工具 —— 通过桌面截图 + OCR 自动识别聊天中的待办事项。

## 功能特性

- 🖥️ **智能截图** - 监控白名单应用（微信），自动截图
- 🔍 **本地 OCR** - PaddleOCR 本地识别，数据不出设备
- 🤖 **AI 提取** - 大模型从聊天文本中提取结构化待办
- 📋 **桌面 Widget** - 待办事项桌面小组件，一目了然
- 💬 **桌面 Copilot** - 悬浮助手窗口，实时显示识别状态
- ☁️ **云端同步** - 远端集中管理，多设备同步

## 技术架构

| 模块 | 技术栈 |
|------|--------|
| 桌面端 | Tauri 2.x + React + TypeScript |
| 本地 OCR | PaddleOCR PP-OCRv4 (Python Sidecar) |
| 大模型 | 可配置 (OpenAI / Ollama) |
| 后端 | Go + Gin + PostgreSQL |

## 项目结构

```
Taskly/
├── apps/
│   ├── desktop/          # Tauri 桌面应用
│   └── server/           # Go 后端服务
├── packages/
│   └── ocr-engine/       # PaddleOCR Sidecar
└── docs/                 # 文档
```

## 开发

### 前置要求

- Node.js >= 18
- pnpm >= 8
- Rust (latest stable)
- Go >= 1.21
- Python >= 3.9

### 快速开始

```bash
# 安装依赖
pnpm install

# 启动桌面应用（开发模式）
pnpm dev

# 启动后端服务
pnpm dev:server
```

## 隐私说明

- 截图数据仅在本地处理，不上传服务器
- OCR 识别完全在本地运行
- 仅在白名单应用前台时工作
- 用户可随时暂停/关闭监控

## License

MIT

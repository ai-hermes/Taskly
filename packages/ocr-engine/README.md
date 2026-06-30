# Legacy OCR Engine - Taskly Sidecar

这是旧版 PaddleOCR sidecar，仅保留作历史参考。桌面端当前已经切换到 Rust 侧的 `ocr-rs` 实现，前端通过 Tauri `recognize_image` 命令调用，不再启动本目录下的 Python 程序或打包 `binaries/ocr-engine`。

## 通信协议

通过 stdin/stdout 以 JSON 格式通信（每行一个 JSON 对象）。

### 命令

#### init - 初始化 OCR 引擎
```json
{"cmd": "init"}
```
响应:
```json
{"success": true, "message": "OCR engine initialized"}
```

#### ocr - 识别图片
```json
{"cmd": "ocr", "image_path": "/path/to/image.png"}
```
响应:
```json
{
  "success": true,
  "text": "识别出的完整文本",
  "details": [
    {"text": "单行文本", "confidence": 0.98, "box": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]}
  ]
}
```

#### ping - 健康检查
```json
{"cmd": "ping"}
```
响应:
```json
{"pong": true}
```

#### quit - 退出
```json
{"cmd": "quit"}
```

## 开发

```bash
# 安装依赖
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 运行
python main.py

# 打包为独立可执行文件
OCR_PYTHON=python3.11 bash build.sh
```

> 说明：PaddlePaddle 当前需要 Python 3.9 - 3.12（推荐 3.11）。如果系统默认是 3.13+，请先安装并指定 `python3.11`。

### 打包注意事项（PaddleOCR 3.x）

PaddleOCR 3.x 底层依赖 PaddleX，打包成独立可执行文件时有两个坑，`build.sh` 已处理：

1. **Pipeline 配置文件**：必须 `--collect-all paddlex`，否则运行时报
   `The pipeline (OCR) does not exist!`。
2. **运行时依赖元数据**：PaddleX 通过 `importlib.metadata.version(...)` 检查
   `ocr`（备选 `ocr-core`）extra 是否满足。PyInstaller 默认不打包第三方包的
   `*.dist-info` 元数据，导致冻结后报
   `` `OCR` requires additional dependencies ``。`build.sh` 用
   `--copy-metadata`（imagesize / opencv-contrib-python / pyclipper /
   pypdfium2 / python-bidi / shapely 等）把这些元数据一并打入。

打包完成后将产物复制到桌面应用的 sidecar 目录（文件名需带 host triple 后缀）：

```bash
cp dist/ocr-engine \
  ../../apps/desktop/src-tauri/binaries/ocr-engine-aarch64-apple-darwin
```

可用以下命令冒烟测试打好的二进制（不依赖 venv）：

```bash
printf '{"cmd":"ocr","image_path":"/path/to/image.png"}\n{"cmd":"quit"}\n' \
  | ./dist/ocr-engine
```

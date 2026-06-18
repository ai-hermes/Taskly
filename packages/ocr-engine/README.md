# OCR Engine - Taskly Sidecar

基于 PaddleOCR 的本地 OCR 引擎，作为 Tauri sidecar 运行。

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
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 运行
python main.py

# 打包为独立可执行文件
bash build.sh
```

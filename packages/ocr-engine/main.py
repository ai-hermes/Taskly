"""
Taskly OCR Engine - PaddleOCR Sidecar
Communicates with Tauri via stdin/stdout JSON protocol.
"""
import sys
import json
import os
from pathlib import Path


def get_model_dir():
    """Get or create model directory"""
    model_dir = Path(__file__).parent / "models"
    model_dir.mkdir(exist_ok=True)
    return str(model_dir)


def init_ocr():
    """Initialize PaddleOCR with lightweight PP-OCRv4 mobile model"""
    from paddleocr import PaddleOCR
    model_root = get_model_dir()
    os.environ.setdefault("PADDLEOCR_HOME", model_root)

    ocr = PaddleOCR(
        use_angle_cls=True,
        lang="ch",
        use_gpu=False,
        # Use mobile (lightweight) models
        det_model_dir=None,  # auto-download
        rec_model_dir=None,  # auto-download
        cls_model_dir=None,  # auto-download
        show_log=False,
    )
    return ocr


def process_image(ocr, image_path: str) -> dict:
    """Process an image and return OCR results"""
    if not os.path.exists(image_path):
        return {"error": f"Image not found: {image_path}"}

    try:
        results = ocr.ocr(image_path, cls=True)
        texts = []
        if results and results[0]:
            for line in results[0]:
                box, (text, confidence) = line
                texts.append({
                    "text": text,
                    "confidence": confidence,
                    "box": box,
                })

        full_text = "\n".join(item["text"] for item in texts)
        return {
            "success": True,
            "text": full_text,
            "details": texts,
        }
    except Exception as e:
        return {"error": str(e)}


def main():
    """Main loop: read JSON from stdin, process, write JSON to stdout"""
    # Signal ready
    ready_msg = json.dumps({"status": "ready", "version": "0.1.0"})
    sys.stdout.write(ready_msg + "\n")
    sys.stdout.flush()

    # Initialize OCR engine
    ocr = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            response = {"error": f"Invalid JSON: {e}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            continue

        cmd = request.get("cmd")

        if cmd == "init":
            try:
                ocr = init_ocr()
                response = {"success": True, "message": "OCR engine initialized"}
            except Exception as e:
                response = {"error": f"Failed to initialize OCR: {e}"}

        elif cmd == "ocr":
            if ocr is None:
                ocr = init_ocr()
            image_path = request.get("image_path")
            if not image_path:
                response = {"error": "Missing image_path"}
            else:
                response = process_image(ocr, image_path)

        elif cmd == "ping":
            response = {"pong": True}

        elif cmd == "quit":
            response = {"status": "shutting_down"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            break

        else:
            response = {"error": f"Unknown command: {cmd}"}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()

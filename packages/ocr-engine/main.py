"""
Taskly OCR Engine - PaddleOCR Sidecar
Communicates with Tauri via stdin/stdout JSON protocol.
"""
import sys
import json
import os
from pathlib import Path


def emit(obj):
    """Write a JSON message to stdout.

    Uses ``ensure_ascii=False`` so Chinese (and other non-ASCII) text stays
    human-readable in the console / logs instead of being escaped to ``\\uXXXX``.
    """
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_model_dir():
    """Get or create model directory"""
    model_dir = Path(__file__).parent / "models"
    model_dir.mkdir(exist_ok=True)
    return str(model_dir)


def init_ocr():
    """Initialize PaddleOCR.

    PaddleOCR 3.x changed its constructor: ``use_angle_cls``/``use_gpu``/
    ``*_model_dir``/``show_log``/``download_path`` were removed or renamed.
    We try the 3.x signature first and fall back to the 2.x one so the same
    script works regardless of the installed version.
    """
    from paddleocr import PaddleOCR

    model_root = get_model_dir()
    os.environ.setdefault("PADDLEOCR_HOME", model_root)

    # PaddleOCR 3.x signature.
    try:
        ocr = PaddleOCR(
            lang="ch",
            use_textline_orientation=True,
        )
        sys.stderr.write("[ocr] initialized with PaddleOCR 3.x API\n")
        sys.stderr.flush()
        return ocr
    except (TypeError, ValueError) as e:
        sys.stderr.write(f"[ocr] 3.x init failed ({e}), trying 2.x API...\n")
        sys.stderr.flush()

    # PaddleOCR 2.x signature.
    ocr = PaddleOCR(
        use_angle_cls=True,
        lang="ch",
        use_gpu=False,
        show_log=False,
    )
    sys.stderr.write("[ocr] initialized with PaddleOCR 2.x API\n")
    sys.stderr.flush()
    return ocr


def _to_box(poly) -> list:
    """Normalize a polygon (numpy array or nested list) to a plain list."""
    if poly is None:
        return []
    tolist = getattr(poly, "tolist", None)
    return tolist() if callable(tolist) else poly


def _parse_v3_result(results) -> list:
    """Parse PaddleOCR 3.x ``predict`` output into a flat list of items."""
    texts = []
    for res in results:
        # 3.x results behave like dicts (OCRResult) or expose a `.json` attr.
        data = res
        if not isinstance(res, dict):
            data = getattr(res, "json", None) or getattr(res, "res", None) or {}
            if isinstance(data, dict) and "res" in data:
                data = data["res"]

        rec_texts = data.get("rec_texts") if isinstance(data, dict) else None
        if rec_texts is None:
            continue

        rec_scores = data.get("rec_scores") or []
        polys = data.get("rec_polys")
        if polys is None:
            polys = data.get("dt_polys") or []

        for i, text in enumerate(rec_texts):
            texts.append({
                "text": text,
                "confidence": float(rec_scores[i]) if i < len(rec_scores) else 0.0,
                "box": _to_box(polys[i]) if i < len(polys) else [],
            })
    return texts


def _parse_v2_result(results) -> list:
    """Parse PaddleOCR 2.x ``ocr`` output into a flat list of items."""
    texts = []
    if results and results[0]:
        for line in results[0]:
            box, (text, confidence) = line
            texts.append({
                "text": text,
                "confidence": float(confidence),
                "box": _to_box(box),
            })
    return texts


def process_image(ocr, image_path: str) -> dict:
    """Process an image and return OCR results"""
    if not os.path.exists(image_path):
        return {"error": f"Image not found: {image_path}"}

    try:
        # Prefer the 3.x `predict` API; fall back to the 2.x `ocr` API.
        if hasattr(ocr, "predict"):
            try:
                results = ocr.predict(image_path)
                texts = _parse_v3_result(results)
            except (TypeError, ValueError):
                results = ocr.ocr(image_path)
                texts = _parse_v2_result(results)
        else:
            results = ocr.ocr(image_path, cls=True)
            texts = _parse_v2_result(results)

        full_text = "\n".join(item["text"] for item in texts)
        return {
            "success": True,
            "text": full_text,
            "details": texts,
        }
    except Exception as e:
        import traceback
        sys.stderr.write(f"[ocr] process_image error: {e}\n{traceback.format_exc()}\n")
        sys.stderr.flush()
        return {"error": str(e)}



def main():
    """Main loop: read JSON from stdin, process, write JSON to stdout"""
    # Ensure stdout/stderr use UTF-8 so Chinese text is readable and never
    # triggers encoding errors under a POSIX/ascii locale (common for the
    # frozen sidecar binary launched by Tauri).
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    # Signal ready
    emit({"status": "ready", "version": "0.1.0"})

    # Initialize OCR engine
    ocr = None

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            emit({"error": f"Invalid JSON: {e}"})
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
            emit({"status": "shutting_down"})
            break

        else:
            response = {"error": f"Unknown command: {cmd}"}

        emit(response)


if __name__ == "__main__":
    main()

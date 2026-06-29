#!/bin/bash
# Build OCR engine as standalone executable using PyInstaller
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# PaddlePaddle wheels are not available on bleeding-edge Python yet.
# Prefer stable runtime versions with published wheels.
PYTHON_CMD="${OCR_PYTHON:-}"
if [ -z "$PYTHON_CMD" ]; then
    for candidate in python3.11 python3.10 python3.12 python3; do
        if command -v "$candidate" >/dev/null 2>&1; then
            version="$("$candidate" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
            case "$version" in
                3.9|3.10|3.11|3.12)
                    PYTHON_CMD="$candidate"
                    break
                    ;;
            esac
        fi
    done
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "ERROR: No supported Python found for PaddlePaddle."
    echo "Please install Python 3.11 (recommended) and rerun."
    echo "macOS (Homebrew): brew install python@3.11"
    echo "Then run: OCR_PYTHON=python3.11 bash packages/ocr-engine/build.sh"
    exit 1
fi

selected_version="$("$PYTHON_CMD" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "$selected_version" in
    3.9|3.10|3.11|3.12)
        ;;
    *)
        echo "ERROR: $PYTHON_CMD is Python $selected_version, unsupported by current PaddlePaddle wheels."
        echo "Use Python 3.11 (recommended): OCR_PYTHON=python3.11 bash packages/ocr-engine/build.sh"
        exit 1
        ;;
esac

# Create virtual environment if not exists, or recreate if interpreter changed
if [ -d "venv" ]; then
    venv_python="$(venv/bin/python -c 'import sys; print(sys.executable)' 2>/dev/null || true)"
    if [ -z "$venv_python" ] || ! venv/bin/python -c "import sys; assert sys.version_info[:2] == tuple(map(int, \"$selected_version\".split('.')))" 2>/dev/null; then
        rm -rf venv
    fi
fi

if [ ! -d "venv" ]; then
    "$PYTHON_CMD" -m venv venv
fi

source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# Build standalone binary
# NOTE: PaddleOCR 3.x delegates to PaddleX, whose pipeline/module config
# YAMLs and registered components must be bundled explicitly. Without
# --collect-all paddlex the frozen binary fails at runtime with
# "The pipeline (OCR) does not exist!".
#
# PaddleX also performs a runtime dependency check via
# importlib.metadata.version(...) for the `ocr` (alt: `ocr-core`) extra.
# PyInstaller does NOT bundle third-party *.dist-info metadata by default,
# so those lookups return None and pipeline creation fails with
# "`OCR` requires additional dependencies". --copy-metadata ships the
# metadata for the ocr-core deps so the check passes in the frozen binary.
pyinstaller \
    --onefile \
    --name ocr-engine \
    --hidden-import paddleocr \
    --hidden-import paddle \
    --hidden-import paddlex \
    --collect-all paddleocr \
    --collect-all paddlex \
    --collect-all paddle \
    --copy-metadata paddleocr \
    --copy-metadata paddlex \
    --copy-metadata imagesize \
    --copy-metadata opencv-contrib-python \
    --copy-metadata pyclipper \
    --copy-metadata pypdfium2 \
    --copy-metadata python-bidi \
    --copy-metadata shapely \
    main.py

echo "Build complete: dist/ocr-engine"
echo "Copy this binary to apps/desktop/src-tauri/binaries/"

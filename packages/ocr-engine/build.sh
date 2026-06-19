#!/bin/bash
# Build OCR engine as standalone executable using PyInstaller
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install pyinstaller

# Build standalone binary
pyinstaller \
    --onefile \
    --name ocr-engine \
    --hidden-import paddleocr \
    --hidden-import paddle \
    --collect-all paddleocr \
    main.py

echo "Build complete: dist/ocr-engine"
echo "Copy this binary to apps/desktop/src-tauri/binaries/"

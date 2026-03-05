#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "[waves] Running setup..."
bash "$SCRIPT_DIR/setup.sh"

echo ""
echo "[waves] Building Go daemon..."
cd "$PROJECT_DIR"
make daemon

echo ""
echo "[waves] Building Electron app..."
cd "$PROJECT_DIR/electron"
npm run build

echo ""
echo "[waves] Packaging Electron app..."
npm run dist

echo ""
echo "[waves] Done! The packaged app is in electron/dist/"
echo "Look for the .dmg or .app in that directory."
echo ""
echo "To run in dev mode instead: make electron-dev"

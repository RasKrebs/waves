#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "[waves] Running setup..."
bash "$SCRIPT_DIR/setup.sh"

echo ""
echo "[waves] Building CLI and daemon..."
cd "$PROJECT_DIR"
make build

echo ""
echo "[waves] Installing wavesd and waves to /usr/local/bin/ (requires sudo)..."
sudo cp build/wavesd /usr/local/bin/
sudo cp build/waves /usr/local/bin/
sudo chmod +x /usr/local/bin/wavesd /usr/local/bin/waves

echo ""
echo "[waves] Done! Installed:"
echo "  wavesd  -> $(which wavesd)"
echo "  waves   -> $(which waves)"
echo ""
echo "Start the daemon:  wavesd"
echo "Check status:      waves status"
echo "Start recording:   waves record"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "[waves] Running setup..."
bash "$SCRIPT_DIR/setup.sh"

echo ""
echo "[waves] Building and installing CLI + daemon..."
cd "$PROJECT_DIR"
make build
sudo cp build/wavesd /usr/local/bin/
sudo cp build/waves /usr/local/bin/
sudo chmod +x /usr/local/bin/wavesd /usr/local/bin/waves

echo ""
echo "[waves] Building Electron app..."
cd "$PROJECT_DIR/electron"
npm run build
npm run dist

echo ""
echo "============================================"
echo "  Waves - Everything installed!"
echo "============================================"
echo ""
echo "  CLI:     $(which waves)"
echo "  Daemon:  $(which wavesd)"
echo "  App:     electron/dist/ (look for .dmg)"
echo "  Config:  ~/.config/waves/config.yaml"
echo ""
echo "  Quick start:"
echo "    wavesd &          # start daemon in background"
echo "    waves status      # check it's running"
echo "    waves record      # start recording"
echo ""

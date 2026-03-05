#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[waves]${NC} $1"; }
ok()    { echo -e "${GREEN}[waves]${NC} $1"; }
warn()  { echo -e "${YELLOW}[waves]${NC} $1"; }
fail()  { echo -e "${RED}[waves]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# --- Homebrew ---

ensure_brew() {
  if command -v brew &>/dev/null; then
    ok "Homebrew found"
    return
  fi
  info "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to path for Apple Silicon
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew installed"
}

# --- Go ---

ensure_go() {
  if command -v go &>/dev/null; then
    local ver
    ver=$(go version | grep -oE 'go[0-9]+\.[0-9]+' | head -1)
    ok "Go found ($ver)"
    return
  fi
  info "Installing Go via Homebrew..."
  brew install go
  ok "Go installed ($(go version | grep -oE 'go[0-9]+\.[0-9]+'))"
}

# --- Node.js ---

ensure_node() {
  if command -v node &>/dev/null; then
    ok "Node.js found ($(node --version))"
    return
  fi
  info "Installing Node.js via Homebrew..."
  brew install node
  ok "Node.js installed ($(node --version))"
}

# --- npm ---

ensure_npm() {
  if command -v npm &>/dev/null; then
    ok "npm found ($(npm --version))"
    return
  fi
  fail "npm not found even after installing Node.js"
}

# --- BlackHole ---

ensure_blackhole() {
  # Check if BlackHole audio device is present
  if system_profiler SPAudioDataType 2>/dev/null | grep -qi "blackhole"; then
    ok "BlackHole audio driver found"
    return
  fi
  info "Installing BlackHole 2ch via Homebrew..."
  brew install blackhole-2ch
  ok "BlackHole 2ch installed"
  warn "You still need to set up a Multi-Output Device in Audio MIDI Setup:"
  warn "  1. Open Audio MIDI Setup (/Applications/Utilities)"
  warn "  2. Click + -> Create Multi-Output Device"
  warn "  3. Check both BlackHole 2ch AND your headphones/speakers"
  warn "  4. Set Multi-Output Device as system output in System Settings -> Sound"
}

# --- whisper.cpp ---

ensure_whisper() {
  if command -v whisper-cli &>/dev/null && whisper-cli --help &>/dev/null; then
    ok "whisper-cli found ($(which whisper-cli))"
    return
  fi
  warn "whisper-cli not found on PATH"
  info "Building whisper.cpp from source..."

  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf $tmp_dir" EXIT

  git clone --depth 1 https://github.com/ggerganov/whisper.cpp "$tmp_dir/whisper.cpp"
  cd "$tmp_dir/whisper.cpp"
  cmake -B build
  cmake --build build --config Release

  local bin_path="$tmp_dir/whisper.cpp/build/bin/whisper-cli"
  if [[ ! -f "$bin_path" ]]; then
    # Some versions put it at a different path
    bin_path=$(find "$tmp_dir/whisper.cpp/build" -name "whisper-cli" -type f 2>/dev/null | head -1)
  fi

  if [[ -z "$bin_path" || ! -f "$bin_path" ]]; then
    warn "Could not build whisper-cli automatically."
    warn "Please build manually: https://github.com/ggerganov/whisper.cpp"
    cd "$PROJECT_DIR"
    return
  fi

  info "Installing whisper-cli to /usr/local/bin/ (requires sudo)..."
  sudo cp "$bin_path" /usr/local/bin/whisper-cli
  sudo chmod +x /usr/local/bin/whisper-cli

  # Copy shared libraries and fix rpaths so the binary doesn't depend on the temp build dir
  local lib_files
  lib_files=$(find "$tmp_dir/whisper.cpp/build" -name "libwhisper*.dylib" -o -name "libggml*.dylib" 2>/dev/null)
  for lib in $lib_files; do
    sudo cp "$lib" /usr/local/lib/
  done
  # Rewrite @rpath references to point to /usr/local/lib
  for lib_name in libwhisper.1.dylib libggml.0.dylib libggml-cpu.0.dylib libggml-blas.0.dylib libggml-metal.0.dylib libggml-base.0.dylib; do
    if [[ -f "/usr/local/lib/$lib_name" ]]; then
      sudo install_name_tool -change "@rpath/$lib_name" "/usr/local/lib/$lib_name" /usr/local/bin/whisper-cli
    fi
  done
  # Also fix inter-library @rpath references
  for lib_file in /usr/local/lib/libwhisper*.dylib /usr/local/lib/libggml*.dylib; do
    [[ -f "$lib_file" ]] || continue
    for lib_name in libwhisper.1.dylib libggml.0.dylib libggml-cpu.0.dylib libggml-blas.0.dylib libggml-metal.0.dylib libggml-base.0.dylib; do
      sudo install_name_tool -change "@rpath/$lib_name" "/usr/local/lib/$lib_name" "$lib_file" 2>/dev/null || true
    done
  done

  cd "$PROJECT_DIR"
  ok "whisper-cli installed to /usr/local/bin/whisper-cli"
}

# --- Go dependencies ---

setup_go_deps() {
  info "Downloading Go dependencies..."
  cd "$PROJECT_DIR"
  go mod download
  ok "Go dependencies ready"
}

# --- Electron / npm dependencies ---

setup_npm_deps() {
  info "Installing Electron npm dependencies..."
  cd "$PROJECT_DIR/electron"
  npm install
  cd "$PROJECT_DIR"
  ok "npm dependencies ready"
}

# --- Config ---

setup_config() {
  local config_dir="$HOME/.config/waves"
  local config_file="$config_dir/config.yaml"
  if [[ -f "$config_file" ]]; then
    ok "Config already exists at $config_file"
    return
  fi
  info "Creating default config at $config_file..."
  mkdir -p "$config_dir"
  cat > "$config_file" << 'YAML'
# Waves configuration
# See README.md for all options

transcription:
  provider: whisper-local
  whisper:
    binary: whisper-cli
    # model: ggml-base.en  # set after downloading a model

summarization:
  provider: claude
  claude:
    api_key: ""  # set your Anthropic API key here
    model: claude-sonnet-4-20250514

# Custom workflows for summarization
# workflows:
#   default:
#     steps:
#       - name: summarize
#         prompt: |
#           Summarize this meeting transcript concisely.
#           Focus on decisions, action items, and key points.
#
#           Transcript:
#           {{.Transcript}}
YAML
  ok "Config created at $config_file"
  warn "Edit $config_file to set your API keys and preferences"
}

# --- Data directory ---

setup_data_dir() {
  local data_dir="$HOME/Library/Application Support/Waves"
  mkdir -p "$data_dir/models" "$data_dir/recordings"
  ok "Data directory ready at $data_dir"
}

# --- Main ---

main() {
  echo ""
  echo -e "${BLUE}=============================${NC}"
  echo -e "${BLUE}  Waves - Setup${NC}"
  echo -e "${BLUE}=============================${NC}"
  echo ""

  ensure_brew
  ensure_go
  ensure_node
  ensure_npm
  ensure_blackhole
  ensure_whisper
  setup_go_deps
  setup_npm_deps
  setup_config
  setup_data_dir

  echo ""
  ok "Setup complete! Next steps:"
  echo ""
  echo "  Build:       make build"
  echo "  Run daemon:  make run-daemon"
  echo "  Run app:     make electron-dev"
  echo ""
}

main "$@"

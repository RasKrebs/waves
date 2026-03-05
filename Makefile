BINARY_DAEMON := wavesd
BINARY_CLI    := waves
BUILD_DIR     := build
INSTALL_DIR   := /usr/local/bin

.PHONY: all build clean install daemon cli electron-install electron-dev electron-build run-daemon status test setup install-cli install-app install-all

all: build

build: daemon cli

daemon:
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_DAEMON) ./cmd/wavesd
	@echo "Built $(BUILD_DIR)/$(BINARY_DAEMON)"

cli:
	@mkdir -p $(BUILD_DIR)
	go build -o $(BUILD_DIR)/$(BINARY_CLI) ./cmd/waves
	@echo "Built $(BUILD_DIR)/$(BINARY_CLI)"

install: build
	sudo cp $(BUILD_DIR)/$(BINARY_DAEMON) $(INSTALL_DIR)/
	sudo cp $(BUILD_DIR)/$(BINARY_CLI) $(INSTALL_DIR)/
	@echo "Installed to $(INSTALL_DIR)"

electron-install:
	cd electron && npm install

electron-dev: daemon
	cd electron && npm run dev

electron-build: build
	cd electron && npm run dist

clean:
	rm -rf $(BUILD_DIR)

run-daemon:
	go run ./cmd/wavesd -v

status:
	$(BUILD_DIR)/$(BINARY_CLI) status

test:
	go test ./...

setup:
	@bash scripts/setup.sh

install-cli:
	@bash scripts/install-cli.sh

install-app:
	@bash scripts/install-app.sh

install-all:
	@bash scripts/install-all.sh

config-init:
	@mkdir -p ~/.config/waves
	@if [ ! -f ~/.config/waves/config.yaml ]; then \
		echo "# Waves configuration" > ~/.config/waves/config.yaml; \
		echo "transcription:" >> ~/.config/waves/config.yaml; \
		echo "  provider: whisper-local" >> ~/.config/waves/config.yaml; \
		echo "  whisper:" >> ~/.config/waves/config.yaml; \
		echo "    binary: whisper-cli" >> ~/.config/waves/config.yaml; \
		echo "summarization:" >> ~/.config/waves/config.yaml; \
		echo "  provider: claude" >> ~/.config/waves/config.yaml; \
		echo "  claude:" >> ~/.config/waves/config.yaml; \
		echo "    api_key: \"\"" >> ~/.config/waves/config.yaml; \
		echo "    model: claude-sonnet-4-20250514" >> ~/.config/waves/config.yaml; \
		echo "Created ~/.config/waves/config.yaml"; \
	else \
		echo "Config already exists at ~/.config/waves/config.yaml"; \
	fi

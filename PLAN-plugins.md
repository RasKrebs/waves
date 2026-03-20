# Plugin System Architecture

User-installable plugins for transcription and LLM providers, with declarative config schemas rendered dynamically in the Electron frontend.

## Design Principles

- **Home Assistant-style Python plugins** with **VS Code-style declarative manifest**
- Plugin authors write a single Python file + a YAML manifest
- Config UI is auto-generated from the manifest schema — no frontend code required for 90% of cases
- Optional custom JS for complex settings (sandboxed iframe)
- Built-in providers remain as-is; plugins are additive

## Comparable Systems

| System | Plugin Lang | Config UI | Sandboxing |
|--------|------------|-----------|------------|
| Obsidian | JS/TS | Declarative JSON schema → rendered by host | Same process |
| VS Code | JS/TS | `contributes.configuration` in package.json | Extension Host process |
| Home Assistant | Python | `config_flow.py` with step-by-step schema | Same process |
| **Waves** | Python | `config_schema` in manifest.yaml → rendered by Electron | Same process (phase 1) |

---

## Plugin Directory Structure

```
~/Library/Application Support/Waves/plugins/
  my-transcription-plugin/
    manifest.yaml           # required: metadata + config schema
    provider.py             # required: factory function
    requirements.txt        # optional: pip dependencies
    README.md               # optional
    ui/                     # optional: custom JS settings component
      settings.js
```

## Manifest Format (`manifest.yaml`)

```yaml
id: xyz-transcription              # unique, kebab-case
name: "XYZ Transcriber"
version: "1.0.0"
description: "Transcription via the XYZ API"
author: "Jane Doe"
homepage: "https://github.com/jane/waves-plugin-xyz"

# What this plugin provides
provides:
  - type: transcription            # or "llm"
    name: xyz                      # registry name → user writes "xyz|model-name"
    entry: provider.py             # file with factory
    factory: create_provider       # function name

# Configuration schema — drives the settings UI
config_schema:
  - key: api_key
    type: secret                   # text | secret | select | toggle | number | url
    label: "API Key"
    required: true
    placeholder: "xyz-..."

  - key: endpoint
    type: url
    label: "API Endpoint"
    default: "https://api.xyz.com/v1"

  - key: model
    type: select
    label: "Default Model"
    options:
      - value: "xyz-fast"
        label: "XYZ Fast"
      - value: "xyz-quality"
        label: "XYZ Quality"
    default: "xyz-fast"
    # OR: dynamic options from plugin code
    # dynamic_options: list_models

  - key: use_gpu
    type: toggle
    label: "GPU acceleration"
    default: true

  - key: beam_size
    type: number
    label: "Beam size"
    default: 5
    min: 1
    max: 20

  - key: auth_type
    type: select
    options: [{ value: api_key, label: "API Key" }, { value: oauth, label: "OAuth" }]

  - key: oauth_token
    type: secret
    label: "OAuth Token"
    visible_when:                  # conditional visibility
      auth_type: oauth

# Optional: custom JS UI for complex settings
custom_ui: ui/settings.js

# Python dependencies
dependencies:
  - "xyz-sdk>=2.0"

min_waves_version: "0.2.0"

permissions:
  - network
  - filesystem_read
```

## Plugin Provider Pattern

Plugin authors write a provider exactly like built-in ones, with one addition: the factory receives a `plugin_config` dict containing user-configured values from the schema.

```python
# provider.py
from waves.providers.base import Segment
from pathlib import Path

class XYZTranscriber:
    def __init__(self, model, api_key, endpoint):
        self._model = model
        self._api_key = api_key
        self._endpoint = endpoint

    @property
    def name(self) -> str:
        return f"xyz|{self._model}"

    async def transcribe_file(self, path: Path, language: str = "", on_progress=None) -> list[Segment]:
        # ... call API, return segments
        pass

def create_provider(model: str | None, config, plugin_config: dict):
    """Factory — called by registry. plugin_config has values from config_schema."""
    return XYZTranscriber(
        model=model or plugin_config.get("model", "xyz-fast"),
        api_key=plugin_config["api_key"],
        endpoint=plugin_config.get("endpoint", "https://api.xyz.com/v1"),
    )
```

The registry wraps plugin factories to inject `plugin_config` transparently — the registry's `_transcription_factories` dict signature stays `(model, config) -> provider`:

```python
def _make_plugin_factory(raw_factory, plugin_id, config_loader):
    def factory(model, config):
        plugin_config = config_loader(plugin_id)
        return raw_factory(model, config, plugin_config)
    return factory
```

## Plugin Config Storage

Stored in the existing `~/.config/waves/config.yaml`:

```yaml
plugins:
  xyz-transcription:
    enabled: true
    config:
      api_key: "xyz-abc123"
      endpoint: "https://api.xyz.com/v1"
      model: "xyz-fast"
      use_gpu: true
```

No new storage mechanism. Reuses existing `config.py` YAML machinery.

---

## Backend Changes

### `registry.py`
- `load_plugin_providers(data_dir, config_loader)` — scan, validate, import, register
- `PluginInfo` dataclass — id, name, version, provides, config_schema, enabled, errors
- `available_plugins() -> list[PluginInfo]`

### `config.py`
- Add `plugins: dict[str, dict]` to `Config` dataclass
- Parse `plugins:` section from YAML

### `server.py` — New RPC Methods
- `Waves.ListPlugins` — installed plugins + metadata + config schema + enabled state
- `Waves.GetPluginConfig` / `Waves.SetPluginConfig` — read/write plugin config values
- `Waves.EnablePlugin` / `Waves.DisablePlugin` — toggle + register/unregister provider
- `Waves.InstallPlugin` / `Waves.UninstallPlugin` — add/remove from plugins dir
- `Waves.GetPluginFieldOptions` — for `dynamic_options` fields
- `Waves.ListAvailableProviders` — all registered provider names (built-in + plugins)

### `__main__.py`
- Call `load_plugin_providers()` after `load_builtin_providers()`

---

## Frontend Changes

### Config Schema → UI Component Mapping

| Schema type | shadcn Component | Notes |
|-------------|-----------------|-------|
| `text` | `<Input>` | Standard text |
| `secret` | `<Input type="password">` | Masked |
| `url` | `<Input type="url">` | URL validation |
| `number` | `<Input type="number">` | min/max from schema |
| `select` | `<Select>` | Static or dynamic options |
| `toggle` | `<Switch>` | Boolean |

All these already exist in the settings dialog — currently hardcoded per provider. The plugin system makes it data-driven.

### New "Plugins" Tab in Settings Dialog

1. List of installed plugins (name, version, enabled toggle)
2. Click to expand → config form rendered from `config_schema`
3. "Install Plugin..." button (folder picker or URL)
4. Provider type badge per plugin ("Transcription" / "LLM")

### Dynamic Form Renderer

```tsx
function PluginConfigForm({ schema, values, onChange }) {
  return schema
    .filter(field => evaluateVisibleWhen(field, values))
    .map(field => {
      switch (field.type) {
        case 'text': case 'url': return <Input ... />
        case 'secret': return <Input type="password" ... />
        case 'select': return <Select options={field.options} ... />
        case 'toggle': return <Switch ... />
        case 'number': return <Input type="number" min={field.min} max={field.max} ... />
      }
    })
}
```

### Custom JS UI (Optional)

For plugins that need more than declarative schema:

- Plugin ships `ui/settings.js` exporting `render(container, { values, onChange })`
- Loaded in a **sandboxed iframe** (`sandbox="allow-scripts"`)
- No access to `window.waves`, Node.js, filesystem
- Communicates via `postMessage` with defined protocol
- CSP restricts external scripts, eval

Most plugins won't need this.

### Provider Dropdown Integration

Transcription/Summarization dropdowns in settings become dynamic — fetched via `Waves.ListAvailableProviders` instead of hardcoded. Plugin providers are tagged with their plugin name.

### IPC Additions

`preload.cts`:
- `plugins:list`, `plugins:getConfig`, `plugins:setConfig`
- `plugins:enable`, `plugins:disable`
- `plugins:install`, `plugins:uninstall`

`waves.d.ts`:
- `PluginInfo`, `PluginConfigField`, `PluginProviderEntry` types

---

## Security Model

### Phase 1 (Ship First)

Plugins run in the same Python process. Trust model: user chose to install it. Same as Obsidian, Home Assistant.

Mitigations:
- Plugins declare `permissions` in manifest (documentation-as-security)
- Import via `importlib` with restricted `sys.path`
- Loading wrapped in try/except — broken plugins don't crash backend
- Custom JS sandboxed in iframe with no parent access

### Phase 2 (Future Hardening)

- Run each plugin in a subprocess, communicate via JSON-RPC over pipe
- Resource limits via `resource` module
- Per-plugin venvs for dependency isolation

---

## Migration Path: Built-in → Plugins

1. **Now**: Built-in providers stay in source tree. Plugins are additive.
2. **Later**: Optionally add `manifest.yaml` to built-in providers. Load via same plugin loader.
3. **Future**: Ship built-ins as pre-installed plugins. Users can disable unused ones.

---

## Implementation Sequence

### Step 1: Backend Plugin Loader
1. Add `plugins:` to Config dataclass
2. Implement `load_plugin_providers()` — scan, validate, import, register
3. Call from `__main__.py`
4. Test with a manually created plugin

### Step 2: Plugin RPCs
5. Add ListPlugins, Get/SetPluginConfig, Enable/Disable RPCs
6. Add Install/Uninstall RPCs

### Step 3: Frontend Plugin Settings
7. TypeScript types for plugins
8. IPC handlers in preload.cts + index.cts
9. `PluginConfigForm` dynamic renderer
10. "Plugins" tab in SettingsDialog

### Step 4: Dynamic Provider Dropdowns
11. `Waves.ListAvailableProviders` RPC
12. Make transcription/summarization dropdowns data-driven

### Step 5: Install UX
13. Folder picker install
14. URL/git install

### Step 6 (Future)
15. Custom JS UI rendering
16. Plugin registry/marketplace
17. Subprocess sandboxing
18. Per-plugin venvs

---

## Gotchas

- **Dependency conflicts**: Start with shared env, add per-plugin venvs if conflicts arise
- **Heavy imports**: Document that plugin imports should be lazy (inside factory or `_ensure_*` pattern)
- **Error isolation**: Wrap loading in try/except, surface errors in UI
- **Config migration**: Apply defaults for missing fields, ignore unknown fields on schema change
- **Hot-swap during recording**: Queue config changes, apply after recording stops

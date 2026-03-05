import { useEffect, useState } from 'react'

export function SettingsView() {
  const [autoDetect, setAutoDetect] = useState(localStorage.getItem('auto_detect') !== 'false')
  const [devices, setDevices]       = useState<{ UID: string; Name: string }[]>([])
  const [status, setStatus]         = useState<any>(null)
  const [config, setConfig]         = useState<any>(null)

  useEffect(() => {
    window.waves.getStatus().then(setStatus).catch(() => {})
    window.waves.listDevices().then((r: any) => setDevices(r?.Devices ?? [])).catch(() => {})
    window.waves.getConfig().then(setConfig).catch(() => {})
  }, [])

  const save = (key: string, val: string) => localStorage.setItem(key, val)

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">Settings</span>
      </div>
      <div className="view-body">

        {/* Audio */}
        <div className="settings-section">
          <div className="settings-section-title">Audio</div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Auto-detect meetings</div>
              <div className="settings-hint">Show banner when Teams, Zoom, Meet etc. are active</div>
            </div>
            <Toggle value={autoDetect} onChange={(v) => { setAutoDetect(v); save('auto_detect', String(v)) }} />
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">BlackHole status</div>
              <div className="settings-hint">Required for system audio capture</div>
            </div>
            <button className="btn btn-ghost" onClick={() => window.waves.openUrl('https://existential.audio/blackhole/')}>
              Check / Install
            </button>
          </div>
          {devices.length > 0 && (
            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
              <div className="settings-label">Audio input devices</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
                {devices.map((d) => (
                  <div key={d.UID} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                    {d.Name}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Providers */}
        {config && (
          <div className="settings-section">
            <div className="settings-section-title">Providers</div>
            <div className="settings-row">
              <div>
                <div className="settings-label">Transcription</div>
                <div className="settings-hint">Configure in ~/.config/waves/config.yaml</div>
              </div>
              <span className="badge badge-done">{config.TranscriptionProvider || 'whisper-local'}</span>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-label">Summarization</div>
                <div className="settings-hint">Configure in ~/.config/waves/config.yaml</div>
              </div>
              <span className="badge badge-done">{config.SummarizationProvider || 'none'}</span>
            </div>
            {config.Workflows?.length > 0 && (
              <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                <div className="settings-label">Workflows</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {config.Workflows.map((w: string) => (
                    <span key={w} className="badge badge-done">{w}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Daemon */}
        <div className="settings-section">
          <div className="settings-section-title">Daemon</div>
          <div className="settings-row">
            <div className="settings-label">Open data folder</div>
            <button className="btn btn-ghost" onClick={() => window.waves.openDataDir()}>Open</button>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-label">Config file</div>
              <div className="settings-hint">~/.config/waves/config.yaml</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 38, height: 22, borderRadius: 11,
        background: value ? 'var(--accent)' : 'var(--bg-raised)',
        border: '1px solid ' + (value ? 'var(--accent)' : 'var(--border)'),
        cursor: 'pointer',
        position: 'relative',
        transition: 'background 0.2s, border-color 0.2s',
        flexShrink: 0,
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: 8,
        background: '#fff',
        position: 'absolute',
        top: 2,
        left: value ? 18 : 2,
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
      }} />
    </button>
  )
}

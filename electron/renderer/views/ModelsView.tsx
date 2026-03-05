import { useEffect, useState } from 'react'

interface Model { Name: string; Type: string; Size: string; Active: boolean }

export function ModelsView() {
  const [models, setModels]     = useState<Model[]>([])
  const [repo, setRepo]         = useState('')
  const [pulling, setPulling]   = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError]       = useState('')

  const reload = () =>
    window.waves.listModels().then((r: any) => setModels(r?.Models ?? []))

  useEffect(() => {
    reload()
    window.waves.on('model:progress', ({ percent }: { percent: number }) => {
      setProgress(Math.round(percent))
    })
  }, [])

  const pull = async () => {
    if (!repo.trim()) return
    setPulling(true)
    setError('')
    setProgress(0)
    try {
      await window.waves.pullModel(repo.trim())
      setRepo('')
      reload()
    } catch (e: any) {
      setError(e.message || 'Pull failed')
    }
    setPulling(false)
    setProgress(null)
  }

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">Models</span>
      </div>
      <div className="view-body">
        <div className="model-list">
          {models.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0' }}>
              No models downloaded yet.
            </div>
          )}
          {models.map((m) => (
            <div key={m.Name} className={`model-card ${m.Active ? 'active' : ''}`}>
              <div>
                <div className="model-name">{m.Name}</div>
                <div className="model-meta">{m.Type} · {m.Size}</div>
              </div>
              <div className="model-actions">
                {!m.Active && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => window.waves.setModel(m.Name).then(reload)}
                  >
                    Use
                  </button>
                )}
                {m.Active && <span style={{ fontSize: 11, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>active</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 20 }}>
          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
            Pull from HuggingFace
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              className="input"
              style={{ flex: 1 }}
              placeholder="e.g. ggerganov/whisper.cpp"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pull()}
              disabled={pulling}
            />
            <button className="btn btn-primary" onClick={pull} disabled={pulling || !repo.trim()}>
              {pulling ? 'Pulling...' : 'Pull'}
            </button>
          </div>

          {progress !== null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-raised)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', transition: 'width 0.2s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {progress}%
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{error}</div>
          )}

          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 8 }}>
            Models must be GGUF/ggml whisper format (.bin or .gguf).<br />
            Recommended:{' '}
            <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>ggerganov/whisper.cpp</code>
          </div>
        </div>
      </div>
    </div>
  )
}

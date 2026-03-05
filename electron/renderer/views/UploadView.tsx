import { useState, useCallback } from 'react'

export function UploadView() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const pickFile = async () => {
    const path = await window.waves.uploadPick()
    if (path) {
      setFilePath(path)
      setStatus('idle')
      setError(null)
      setSessionId(null)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      setFilePath(file.path)
      setStatus('idle')
      setError(null)
      setSessionId(null)
    }
  }, [])

  const handleTranscribe = async () => {
    if (!filePath) return
    setStatus('uploading')
    setError(null)
    try {
      const r = await window.waves.uploadTranscribe(filePath, title || '')
      setSessionId(r?.SessionID ?? null)
      setStatus('done')
    } catch (err: any) {
      setError(err?.message ?? 'Transcription failed')
      setStatus('error')
    }
  }

  const reset = () => {
    setFilePath(null)
    setTitle('')
    setStatus('idle')
    setSessionId(null)
    setError(null)
  }

  const fileName = filePath?.split('/').pop() ?? ''

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">Upload Recording</span>
      </div>

      <div className="view-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        {!filePath ? (
          <div
            className={`upload-drop-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={pickFile}
          >
            <UploadIcon />
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              Drop audio file here or click to browse
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              WAV, MP3, MP4, M4A, OGG, FLAC, WebM
            </p>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="upload-file-card">
              <AudioFileIcon />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fileName}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  Ready to transcribe
                </div>
              </div>
              <button className="btn btn-ghost" onClick={reset} style={{ padding: '4px 8px', fontSize: 11 }}>
                Change
              </button>
            </div>

            <input
              className="input"
              style={{ width: '100%' }}
              placeholder="Title (optional, defaults to filename)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <button
              className="btn btn-primary"
              onClick={handleTranscribe}
              disabled={status === 'uploading'}
              style={{ alignSelf: 'flex-start' }}
            >
              {status === 'uploading' ? 'Transcribing...' : 'Transcribe'}
            </button>

            {status === 'done' && sessionId && (
              <div className="upload-result">
                <span className="badge badge-done">done</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Session created. View it in History.
                </span>
              </div>
            )}

            {status === 'error' && error && (
              <div className="upload-result" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                <span className="badge badge-recording">error</span>
                <span style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function UploadIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ opacity: 0.4 }}>
      <path d="M20 6v20M12 14l8-8 8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 26v4a4 4 0 004 4h20a4 4 0 004-4v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

function AudioFileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="3" y="2" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
      <path d="M7 7h6" stroke="var(--accent)" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

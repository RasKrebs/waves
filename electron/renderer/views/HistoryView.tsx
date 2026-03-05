import { useEffect, useState } from 'react'

interface Session { ID: string; Title: string; StartedAt: string; Duration: string; Status: string }
interface Detail  { Title: string; Duration: string; Summary: string; Segments: { Timestamp: string; Text: string }[] }

export function HistoryView() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail]     = useState<Detail | null>(null)
  const [loading, setLoading]   = useState(false)
  const [summarizing, setSummarizing] = useState(false)

  useEffect(() => {
    window.waves.listSessions(50).then((r: any) => setSessions(r?.Sessions ?? []))
  }, [])

  const select = async (id: string) => {
    setSelected(id)
    setDetail(null)
    setLoading(true)
    const r = await window.waves.getSession(id)
    setDetail(r?.Session ?? null)
    setLoading(false)
  }

  const handleSummarize = async () => {
    if (!selected) return
    setSummarizing(true)
    const r = await window.waves.summarize(selected)
    if (r?.Summary && detail) {
      setDetail({ ...detail, Summary: r.Summary })
    }
    setSummarizing(false)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="view" style={{ padding: 0 }}>
      <div className="history-layout">
        <aside className="history-sidebar">
          <div style={{ padding: '12px 8px 8px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {sessions.length} sessions
          </div>
          <div className="session-list">
            {sessions.length === 0 && (
              <div style={{ padding: '24px 12px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                No recordings yet
              </div>
            )}
            {sessions.map((s) => (
              <div
                key={s.ID}
                className={`session-item ${selected === s.ID ? 'selected' : ''}`}
                onClick={() => select(s.ID)}
              >
                <div className="session-info">
                  <div className="session-title">{s.Title}</div>
                  <div className="session-meta">
                    {formatDate(s.StartedAt)}
                    {s.Duration ? ` · ${s.Duration}` : ''}
                  </div>
                </div>
                <StatusBadge status={s.Status} />
              </div>
            ))}
          </div>
        </aside>

        <div className="history-detail">
          {!selected && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: 10 }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" style={{ opacity: 0.3 }}>
                <rect x="4" y="6" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M9 12h14M9 17h10M9 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <p style={{ fontSize: 13 }}>Select a session to view transcript</p>
            </div>
          )}

          {selected && loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
              Loading...
            </div>
          )}

          {detail && !loading && (
            <>
              <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{detail.Title}</h2>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {detail.Duration ? `Duration: ${detail.Duration}` : ''}
                  </div>
                </div>
                {!detail.Summary && (
                  <button
                    className="btn btn-primary"
                    onClick={handleSummarize}
                    disabled={summarizing}
                  >
                    {summarizing ? 'Summarizing...' : 'Summarize'}
                  </button>
                )}
              </div>

              {detail.Summary && (
                <div className="summary-box">
                  <div className="summary-label">Summary</div>
                  <div className="summary-text">{detail.Summary}</div>
                </div>
              )}

              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-muted)', marginBottom: 12 }}>
                Transcript - {detail.Segments?.length ?? 0} segments
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(detail.Segments ?? []).map((seg, i) => (
                  <div key={i} className="segment">
                    <span className="segment-time">{seg.Timestamp}</span>
                    <span className="segment-text">{seg.Text}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'recording' ? 'badge-recording'
    : status === 'done' ? 'badge-done'
    : 'badge-processing'
  return <span className={`badge ${cls}`}>{status}</span>
}

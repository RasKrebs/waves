export function StatusBar({ connected, recording }: { connected: boolean; recording: boolean }) {
  const dotClass = !connected ? 'offline' : recording ? 'recording' : 'connected'
  const label    = !connected ? 'daemon offline' : recording ? 'recording' : 'ready'

  return (
    <div className="status-bar">
      <div className={`status-dot ${dotClass}`} />
      <span>{label}</span>
    </div>
  )
}

export function MeetingBanner({
  appName,
  onRecord,
  onDismiss,
}: {
  appName: string
  onRecord: () => void
  onDismiss: () => void
}) {
  return (
    <div className="meeting-banner">
      <div className="banner-icon">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 5a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8l-3 3v-3H4a2 2 0 01-2-2V5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="banner-text">
        <div className="banner-title">{appName} meeting detected</div>
        <div className="banner-sub">Record and transcribe this session?</div>
      </div>
      <div className="banner-actions">
        <button className="btn btn-ghost" style={{ padding: '5px 10px' }} onClick={onDismiss}>
          Dismiss
        </button>
        <button className="btn btn-danger" style={{ padding: '5px 10px' }} onClick={onRecord}>
          Record
        </button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { LiveView } from './views/LiveView'
import { HistoryView } from './views/HistoryView'
import { ModelsView } from './views/ModelsView'
import { SettingsView } from './views/SettingsView'
import { StatusBar, MeetingBanner } from './components/StatusBar'

export type View = 'live' | 'history' | 'models' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('live')
  const [isRecording, setIsRecording] = useState(false)
  const [detectedMeeting, setDetectedMeeting] = useState<string | null>(null)
  const [daemonConnected, setDaemonConnected] = useState(false)

  useEffect(() => {
    const poll = async () => {
      try {
        const status = await window.waves.getStatus()
        setDaemonConnected(true)
        setIsRecording(status.State === 'recording')
      } catch {
        setDaemonConnected(false)
      }
    }
    poll()
    const interval = setInterval(poll, 3000)

    window.waves.on('meeting:detected', ({ app }: { app: string }) => {
      setDetectedMeeting(app)
    })
    window.waves.on('meeting:ended', () => {
      setDetectedMeeting(null)
    })
    window.waves.on('recording:started', () => setIsRecording(true))
    window.waves.on('recording:stopped', () => setIsRecording(false))

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="app-root">
      {detectedMeeting && (
        <MeetingBanner
          appName={detectedMeeting}
          onRecord={() => {
            window.waves.startRecording('')
            setDetectedMeeting(null)
            setView('live')
          }}
          onDismiss={() => setDetectedMeeting(null)}
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="logo-icon">
            <RecordIcon active={isRecording} />
          </span>
          <span className="logo-text">Waves</span>
        </div>

        <nav className="sidebar-nav">
          {([
            ['live',     'Live',     <WaveIcon />],
            ['history',  'History',  <ClockIcon />],
            ['models',   'Models',   <CpuIcon />],
            ['settings', 'Settings', <GearIcon />],
          ] as [View, string, React.ReactNode][]).map(([id, label, icon]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? 'active' : ''}`}
              onClick={() => setView(id)}
            >
              {icon}
              <span>{label}</span>
              {id === 'live' && isRecording && <span className="recording-dot" />}
            </button>
          ))}
        </nav>

        <StatusBar connected={daemonConnected} recording={isRecording} />
      </aside>

      <main className="main-content">
        {view === 'live'     && <LiveView isRecording={isRecording} setIsRecording={setIsRecording} />}
        {view === 'history'  && <HistoryView />}
        {view === 'models'   && <ModelsView />}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  )
}

function RecordIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="10" cy="10" r="4" fill={active ? '#ef4444' : 'currentColor'}
        style={{ transition: 'fill 0.3s' }}
      />
    </svg>
  )
}
function WaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M1 8h2M3 5v6M5 3v10M7 6v4M9 4v8M11 5v6M13 7v2M15 8h-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 4.5V8l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function CpuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M6 2v2M10 2v2M6 12v2M10 12v2M2 6h2M2 10h2M12 6h2M12 10h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}
function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M2.93 2.93l1.41 1.41M11.66 11.66l1.41 1.41M2.93 13.07l1.41-1.41M11.66 4.34l1.41-1.41" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

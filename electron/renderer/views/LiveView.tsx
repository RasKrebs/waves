import { useEffect, useRef, useState } from 'react'

interface Segment { timestamp: string; text: string; live?: boolean }

export function LiveView({
  isRecording,
  setIsRecording,
}: {
  isRecording: boolean
  setIsRecording: (v: boolean) => void
}) {
  const [segments, setSegments] = useState<Segment[]>([])
  const [title, setTitle] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isRecording) { startRef.current = null; setElapsed(0); return }
    if (!startRef.current) startRef.current = Date.now()
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current!) / 1000)), 500)
    return () => clearInterval(t)
  }, [isRecording])

  useEffect(() => {
    const handler = (seg: { timestamp: string; text: string }) => {
      setSegments((prev) => {
        const updated = prev.filter((s) => !s.live)
        return [...updated, { ...seg, live: false }]
      })
    }
    window.waves.on('transcript:segment', handler)
    return () => window.waves.off('transcript:segment', handler)
  }, [])

  useEffect(() => {
    if (isRecording) setSegments([])
  }, [isRecording])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [segments])

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleStart = async () => {
    await window.waves.startRecording(title || '')
    setIsRecording(true)
  }
  const handleStop = async () => {
    await window.waves.stopRecording()
    setIsRecording(false)
  }

  return (
    <div className="view">
      <div className="view-header">
        <span className="view-title">Live Transcript</span>
        <div className="recording-controls">
          {isRecording && (
            <span className="recording-timer">{formatTime(elapsed)}</span>
          )}
          {!isRecording ? (
            <>
              <input
                className="input"
                style={{ width: 180 }}
                placeholder="Meeting title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStart()}
              />
              <button className="btn btn-danger" onClick={handleStart}>
                <RecordDot /> Record
              </button>
            </>
          ) : (
            <button className="btn btn-ghost" onClick={handleStop}>
              <StopRect /> Stop
            </button>
          )}
        </div>
      </div>

      <div className="transcript-area">
        {segments.length === 0 ? (
          <div className="transcript-empty">
            <WaveformIllustration active={isRecording} />
            <p>{isRecording ? 'Listening... transcript will appear shortly' : 'Start recording to see live transcript'}</p>
          </div>
        ) : (
          segments.map((seg, i) => (
            <div key={i} className={`segment ${seg.live ? 'live' : ''}`}>
              <span className="segment-time">{seg.timestamp}</span>
              <span className="segment-text">{seg.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function RecordDot() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="4" fill="currentColor"/>
    </svg>
  )
}
function StopRect() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/>
    </svg>
  )
}

function WaveformIllustration({ active }: { active: boolean }) {
  const bars = [3, 7, 12, 8, 14, 6, 10, 5, 13, 9, 4, 11, 7, 3]
  return (
    <svg width="80" height="28" viewBox="0 0 80 28">
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 6 + 1}
          y={(28 - h) / 2}
          width="4"
          height={h}
          rx="2"
          fill="currentColor"
          style={{
            opacity: active ? 1 : 0.3,
            animation: active ? `bar-anim ${0.4 + i * 0.07}s ease-in-out infinite alternate` : 'none',
          }}
        />
      ))}
      <style>{`
        @keyframes bar-anim {
          from { transform: scaleY(0.3); transform-origin: center; }
          to   { transform: scaleY(1);   transform-origin: center; }
        }
      `}</style>
    </svg>
  )
}

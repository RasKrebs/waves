import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useCallback, useRef } from "react"
import { Clock, ChevronRight, ArrowLeft, Loader2, Play, Pause, Volume2, RefreshCw, Pencil, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { SessionRow, SessionDetail } from "../types/waves"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)

  if (days === 0) return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  if (days === 1) return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
}

function formatPlayerTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-500/10 text-green-600 dark:text-green-400",
    done: "bg-green-500/10 text-green-600 dark:text-green-400",
    recording: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    transcribing: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  )
}

function AudioPlayer({ audioPath }: { audioPath: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!audioPath) {
      setLoading(false)
      return
    }
    window.waves.getAudioUrl(audioPath).then((url) => {
      setAudioUrl(url)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [audioPath])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }

  if (loading) return null
  if (!audioUrl) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
      />

      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={togglePlay}>
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5 ml-0.5" />}
      </Button>

      <span className="text-xs tabular-nums text-muted-foreground w-10 text-right shrink-0">
        {formatPlayerTime(currentTime)}
      </span>

      <div
        className="flex-1 h-1.5 rounded-full bg-muted cursor-pointer relative group"
        onClick={handleSeek}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/30 group-hover:bg-foreground/50 transition-colors"
          style={{ width: `${progress}%` }}
        />
      </div>

      <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0">
        {formatPlayerTime(duration)}
      </span>

      <Volume2 className="size-3.5 text-muted-foreground/50 shrink-0" />
    </div>
  )
}

function EditableTitle({
  sessionId,
  initialTitle,
  onRenamed,
}: {
  sessionId: string
  initialTitle: string
  onRenamed: (title: string, audioPath: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(initialTitle)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed || trimmed === initialTitle) {
      setTitle(initialTitle)
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await window.waves.renameSession(sessionId, trimmed)
      onRenamed(trimmed, res.AudioPath)
      setEditing(false)
    } catch (err) {
      console.error("Failed to rename session:", err)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave()
            if (e.key === "Escape") { setTitle(initialTitle); setEditing(false) }
          }}
          className="h-7 text-lg font-semibold px-1.5"
          disabled={saving}
        />
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </Button>
      </div>
    )
  }

  return (
    <button
      className="flex items-center gap-1.5 group text-left"
      onClick={() => setEditing(true)}
    >
      <h2 className="text-lg font-semibold">{initialTitle || "Untitled session"}</h2>
      <Pencil className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  )
}

function SessionListView({
  sessions,
  loading,
  onSelect,
}: {
  sessions: SessionRow[]
  loading: boolean
  onSelect: (id: string) => void
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <Clock className="size-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No sessions yet</p>
        <p className="text-xs text-muted-foreground/60">Recordings will appear here after you stop them.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {sessions.map((s) => (
        <button
          key={s.ID}
          onClick={() => onSelect(s.ID)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/50 transition-colors group"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">
                {s.Title || "Untitled session"}
              </span>
              <StatusBadge status={s.Status} />
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-muted-foreground">{formatDate(s.StartedAt)}</span>
              {s.Duration && (
                <>
                  <span className="text-xs text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">{s.Duration}</span>
                </>
              )}
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
        </button>
      ))}
    </div>
  )
}

function SessionDetailView({
  sessionId,
  detail,
  loading,
  onBack,
  onDetailUpdate,
}: {
  sessionId: string
  detail: SessionDetail | null
  loading: boolean
  onBack: () => void
  onDetailUpdate: (detail: SessionDetail) => void
}) {
  const [retranscribing, setRetranscribing] = useState(false)

  if (loading || !detail) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const handleRetranscribe = async () => {
    setRetranscribing(true)
    try {
      await window.waves.retranscribe(sessionId)
      // Reload the session to get new segments
      const res = await window.waves.getSession(sessionId)
      onDetailUpdate(res.Session)
    } catch (err) {
      console.error("Failed to retranscribe:", err)
    } finally {
      setRetranscribing(false)
    }
  }

  const handleRenamed = (title: string, audioPath: string) => {
    onDetailUpdate({ ...detail, Title: title, AudioPath: audioPath })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="size-7" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <EditableTitle
            sessionId={sessionId}
            initialTitle={detail.Title || "Untitled session"}
            onRenamed={handleRenamed}
          />
          <p className="text-xs text-muted-foreground">
            {formatDate(detail.StartedAt)}
            {detail.Duration && ` · ${detail.Duration}`}
          </p>
        </div>
        {detail.AudioPath && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs shrink-0"
            onClick={handleRetranscribe}
            disabled={retranscribing}
          >
            {retranscribing ? (
              <Loader2 className="size-3 animate-spin mr-1.5" />
            ) : (
              <RefreshCw className="size-3 mr-1.5" />
            )}
            {retranscribing ? "Transcribing..." : "Re-transcribe"}
          </Button>
        )}
      </div>

      {detail.AudioPath && <AudioPlayer audioPath={detail.AudioPath} />}

      {detail.Summary && (
        <>
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Summary</h3>
            <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
              {detail.Summary}
            </div>
          </div>
          <Separator />
        </>
      )}

      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Transcript</h3>
        {retranscribing ? (
          <div className="flex items-center gap-2 py-4 justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Re-transcribing with current model...</p>
          </div>
        ) : detail.Segments && detail.Segments.length > 0 ? (
          <div className="space-y-2">
            {detail.Segments.map((seg, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 pt-0.5 w-16 text-right">
                  {seg.Timestamp}
                </span>
                <span className="text-foreground/90">{seg.Text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No transcript segments.</p>
        )}
      </div>
    </div>
  )
}

function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchSessions = useCallback(async () => {
    try {
      setLoading(true)
      const res = await window.waves.listSessions(50)
      setSessions(res.Sessions ?? [])
    } catch (err) {
      console.error("Failed to list sessions:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()

    const onStopped = () => fetchSessions()
    window.waves?.on("recording:stopped", onStopped)
    return () => {
      window.waves?.off("recording:stopped", onStopped)
    }
  }, [fetchSessions])

  const handleSelect = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    try {
      const res = await window.waves.getSession(id)
      setDetail(res.Session)
    } catch (err) {
      console.error("Failed to get session:", err)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleBack = () => {
    setSelectedId(null)
    setDetail(null)
    fetchSessions() // refresh list in case title changed
  }

  if (selectedId) {
    return (
      <div className="flex flex-col h-full p-2">
        <SessionDetailView
          sessionId={selectedId}
          detail={detail}
          loading={detailLoading}
          onBack={handleBack}
          onDetailUpdate={setDetail}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold">History</h1>
      </div>
      <SessionListView sessions={sessions} loading={loading} onSelect={handleSelect} />
    </div>
  )
}

import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState, useEffect, useCallback, useRef } from "react"
import {
  Clock, ArrowLeft, Loader2, Play, Pause, Volume2, RefreshCw, Pencil, Check,
  FileText, Sparkles, ChevronDown, Trash2, FolderOpen, Tag, Calendar,
  AudioWaveform,
} from "lucide-react"
import { NoteEditor } from "@/components/note-editor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { SessionRow, SessionDetail, NoteView, NoteTemplate, ProjectRow } from "../types/waves"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
  validateSearch: (search: Record<string, unknown>): { session?: string } => ({
    session: typeof search.session === 'string' ? search.session : undefined,
  }),
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

function AudioPlayer({ audioPath }: { audioPath: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!audioPath) { setLoading(false); return }
    window.waves.getAudioUrl(audioPath).then((url) => {
      setAudioUrl(url)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [audioPath])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else audio.play()
  }

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * duration
  }

  if (loading || !audioUrl) return null
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 px-3 py-2">
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
      <div className="flex-1 h-1.5 rounded-full bg-muted cursor-pointer relative group" onClick={handleSeek}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground/25 group-hover:bg-foreground/40 transition-colors"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-10 shrink-0">
        {formatPlayerTime(duration)}
      </span>
      <Volume2 className="size-3.5 text-muted-foreground/40 shrink-0" />
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
          className="h-8 text-lg font-semibold px-1.5"
          disabled={saving}
        />
        <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        </Button>
      </div>
    )
  }

  return (
    <button className="flex items-center gap-1.5 group text-left" onClick={() => setEditing(true)}>
      <h2 className="text-lg font-semibold">{initialTitle || "Untitled session"}</h2>
      <Pencil className="size-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  )
}

/** Group sessions by date label */
function groupByDate(sessions: SessionRow[]): { label: string; sessions: SessionRow[] }[] {
  const groups: Map<string, SessionRow[]> = new Map()
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)

  for (const s of sessions) {
    const d = new Date(s.StartedAt)
    let label: string
    if (d >= today) label = "Today"
    else if (d >= yesterday) label = "Yesterday"
    else if (d >= weekAgo) label = "This Week"
    else label = d.toLocaleDateString([], { month: "long", year: "numeric" })

    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(s)
  }

  return Array.from(groups.entries()).map(([label, sessions]) => ({ label, sessions }))
}

function SessionListView({
  sessions,
  loading,
  onSelect,
  onDelete,
}: {
  sessions: SessionRow[]
  loading: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16">
        <AudioWaveform className="size-8 text-muted-foreground/20" />
        <p className="text-sm text-muted-foreground/50">No meetings yet</p>
        <p className="text-xs text-muted-foreground/30">Start a recording or upload audio to get started.</p>
      </div>
    )
  }

  const groups = groupByDate(sessions)

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await window.waves.deleteSession(id)
      onDelete(id)
    } catch (err) {
      console.error("Failed to delete session:", err)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-widest mb-1.5 px-2">
            {group.label}
          </div>
          <div className="space-y-px">
            {group.sessions.map((s) => (
              <div
                key={s.ID}
                onClick={() => onSelect(s.ID)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left rounded-lg hover:bg-muted/40 transition-colors group cursor-pointer"
              >
                <FileText className="size-3.5 text-muted-foreground/30 shrink-0 group-hover:text-muted-foreground/50 transition-colors" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">
                    {s.Title || "Untitled"}
                  </span>
                  {s.MeetingType && (
                    <span className="text-[10px] text-muted-foreground/40 mt-0.5 block">
                      {s.MeetingType.replace(/-/g, " ")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.Duration && (
                    <span className="text-[11px] text-muted-foreground/30 tabular-nums">{s.Duration}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground/30 tabular-nums">
                    {new Date(s.StartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, s.ID)}
                    className="size-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all"
                  >
                    {deletingId === s.ID ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MeetingNotes({
  sessionId,
  notes,
  onNotesChange,
}: {
  sessionId: string
  notes: NoteView[]
  onNotesChange: () => void
}) {
  const [generating, setGenerating] = useState<string | null>(null)
  const [templates, setTemplates] = useState<NoteTemplate[]>([])

  useEffect(() => {
    window.waves.listNoteTemplates()
      .then((res) => setTemplates(res.Templates ?? []))
      .catch(() => {
        setTemplates([
          { Key: "general-meeting", Name: "General Meeting", Description: "Standard meeting notes" },
          { Key: "standup", Name: "Standup", Description: "Daily standup format" },
        ])
      })
  }, [])

  const handleGenerate = async (noteType: string) => {
    setGenerating(noteType)
    try {
      await window.waves.generateNotes(sessionId, noteType)
      onNotesChange()
    } catch (err) {
      console.error("Failed to generate notes:", err)
    } finally {
      setGenerating(null)
    }
  }

  const handleDelete = async (noteId: string) => {
    try {
      await window.waves.deleteNote(noteId)
      onNotesChange()
    } catch (err) {
      console.error("Failed to delete note:", err)
    }
  }

  const noteTypes = [
    ...templates.map((t) => ({ id: t.Key, label: t.Name, desc: t.Description })),
    { id: "action-items", label: "Action Items", desc: "Checklist of tasks and owners" },
    { id: "summary", label: "Executive Summary", desc: "Brief overview for catch-up" },
  ]

  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <div key={note.ID} className="rounded-lg border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-widest">
              {note.NoteType.replace(/-/g, " ")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground/30 hover:text-destructive"
              onClick={() => handleDelete(note.ID)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
          <NoteEditor
            note={note}
            onContentUpdate={async (noteId, content) => {
              try {
                await window.waves.updateNote(noteId, content)
              } catch (err) {
                console.error("Failed to update note:", err)
              }
            }}
          />
        </div>
      ))}

      {/* Generate buttons */}
      <div className="flex flex-wrap gap-2">
        {noteTypes.map((nt) => {
          const exists = notes.some((n) => n.NoteType === nt.id)
          return (
            <Button
              key={nt.id}
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => handleGenerate(nt.id)}
              disabled={generating !== null}
              title={nt.desc}
            >
              {generating === nt.id ? (
                <Loader2 className="size-3 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="size-3 mr-1.5" />
              )}
              {exists ? `Regenerate ${nt.label}` : `Generate ${nt.label}`}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

function MeetingTypePicker({
  sessionId,
  currentType,
  onTypeChanged,
}: {
  sessionId: string
  currentType: string
  onTypeChanged: (type: string) => void
}) {
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.waves.listNoteTemplates()
      .then((res) => setTemplates(res.Templates ?? []))
      .catch(() => {})
  }, [])

  const handleChange = async (newType: string) => {
    if (newType === currentType) return
    setSaving(true)
    try {
      await window.waves.setMeetingType(sessionId, newType || null, !!newType)
      onTypeChanged(newType)
    } catch (err) {
      console.error("Failed to set meeting type:", err)
    } finally {
      setSaving(false)
    }
  }

  if (templates.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      <Tag className="size-3 text-muted-foreground/50" />
      <select
        value={currentType}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="h-6 text-[11px] rounded border border-border/60 bg-background px-1.5 text-muted-foreground disabled:opacity-50"
      >
        <option value="">No type</option>
        {templates.map((t) => (
          <option key={t.Key} value={t.Key}>{t.Name}</option>
        ))}
      </select>
      {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

function ProjectAssigner({
  sessionId,
  currentProjectId,
  onProjectChanged,
}: {
  sessionId: string
  currentProjectId: string
  onProjectChanged: (projectId: string) => void
}) {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.waves.listProjects()
      .then((res) => setProjects(res.Projects ?? []))
      .catch(() => {})
  }, [])

  const handleChange = async (projectId: string) => {
    if (projectId === currentProjectId) return
    setSaving(true)
    try {
      await window.waves.assignSession(sessionId, projectId || null)
      onProjectChanged(projectId)
    } catch (err) {
      console.error("Failed to assign project:", err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <FolderOpen className="size-3 text-muted-foreground/50" />
      <select
        value={currentProjectId}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="h-6 text-[11px] rounded border border-border/60 bg-background px-1.5 text-muted-foreground disabled:opacity-50"
      >
        <option value="">No project</option>
        {projects.map((p) => (
          <option key={p.ID} value={p.ID}>{p.Name}</option>
        ))}
      </select>
      {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  )
}

function SessionDetailView({
  sessionId,
  detail,
  loading,
  onBack,
  onDetailUpdate,
  onDelete,
}: {
  sessionId: string
  detail: SessionDetail | null
  loading: boolean
  onBack: () => void
  onDetailUpdate: (detail: SessionDetail) => void
  onDelete: () => void
}) {
  const [retranscribing, setRetranscribing] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const [showMeta, setShowMeta] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const onNotesReady = (data: { SessionID: string }) => {
      if (data.SessionID === sessionId) {
        window.waves.getSession(sessionId).then((res) => {
          onDetailUpdate(res.Session)
        }).catch(console.error)
      }
    }
    window.waves?.on("notes:ready", onNotesReady)
    return () => { window.waves?.off("notes:ready", onNotesReady) }
  }, [sessionId, onDetailUpdate])

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
      const res = await window.waves.getSession(sessionId)
      onDetailUpdate(res.Session)
    } catch (err) {
      console.error("Failed to retranscribe:", err)
    } finally {
      setRetranscribing(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await window.waves.deleteSession(sessionId)
      onDelete()
    } catch (err) {
      console.error("Failed to delete session:", err)
    } finally {
      setDeleting(false)
    }
  }

  const handleRenamed = (title: string, audioPath: string) => {
    onDetailUpdate({ ...detail, Title: title, AudioPath: audioPath })
  }

  const handleNotesChange = async () => {
    try {
      const res = await window.waves.getSession(sessionId)
      onDetailUpdate(res.Session)
    } catch (err) {
      console.error("Failed to refresh session:", err)
    }
  }

  const hasNotes = detail.Notes && detail.Notes.length > 0
  const hasTranscript = detail.Segments && detail.Segments.length > 0

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <ArrowLeft className="size-3" />
            <span>Meetings</span>
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground/40 hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="size-3 animate-spin mr-1" /> : <Trash2 className="size-3 mr-1" />}
            Delete
          </Button>
        </div>
        <EditableTitle
          sessionId={sessionId}
          initialTitle={detail.Title || "Untitled session"}
          onRenamed={handleRenamed}
        />
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground/50">
          <Calendar className="size-3" />
          <span>{formatDate(detail.StartedAt)}</span>
          {detail.Duration && (
            <>
              <span className="text-muted-foreground/25">·</span>
              <Clock className="size-3" />
              <span>{detail.Duration}</span>
            </>
          )}
        </div>
      </div>

      {/* Collapsible metadata */}
      <div className="border-y border-border/50">
        <button
          onClick={() => setShowMeta(!showMeta)}
          className="flex items-center justify-between w-full py-2 text-xs text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <FolderOpen className="size-3" />
              {detail.ProjectID ? "Assigned" : "No project"}
            </span>
            <span className="flex items-center gap-1">
              <Tag className="size-3" />
              {detail.MeetingType || "No type"}
            </span>
          </div>
          <ChevronDown className={`size-3 transition-transform duration-150 ${showMeta ? "" : "-rotate-90"}`} />
        </button>
        {showMeta && (
          <div className="pb-2.5 flex items-center gap-4 flex-wrap">
            <ProjectAssigner
              sessionId={sessionId}
              currentProjectId={detail.ProjectID}
              onProjectChanged={(pid) => onDetailUpdate({ ...detail, ProjectID: pid })}
            />
            <MeetingTypePicker
              sessionId={sessionId}
              currentType={detail.MeetingType}
              onTypeChanged={async (type) => {
                onDetailUpdate({ ...detail, MeetingType: type, Notes: [] })
                if (type) {
                  for (let i = 0; i < 30; i++) {
                    await new Promise((r) => setTimeout(r, 2000))
                    try {
                      const res = await window.waves.getSession(sessionId)
                      if (res.Session.Notes && res.Session.Notes.length > 0) {
                        onDetailUpdate(res.Session)
                        break
                      }
                    } catch { break }
                  }
                }
              }}
            />
            {detail.AudioPath && (
              <button
                onClick={handleRetranscribe}
                disabled={retranscribing}
                className="flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`size-3 ${retranscribing ? "animate-spin" : ""}`} />
                {retranscribing ? "Transcribing..." : "Re-transcribe"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Audio player */}
      {detail.AudioPath && <AudioPlayer audioPath={detail.AudioPath} />}

      {/* Meeting Notes */}
      {hasTranscript ? (
        <>
          {!hasNotes && (
            <div className="flex items-center gap-2 py-3">
              <Loader2 className="size-3.5 animate-spin text-muted-foreground/50" />
              <span className="text-sm text-muted-foreground/50">Generating notes...</span>
            </div>
          )}
          <MeetingNotes
            sessionId={sessionId}
            notes={detail.Notes ?? []}
            onNotesChange={handleNotesChange}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground/50 py-4">
          No transcript yet. Notes will appear after transcription.
        </p>
      )}

      {/* Transcript */}
      {hasTranscript && (
        <div className="border-t border-border/40 pt-3">
          <button
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors uppercase tracking-widest"
            onClick={() => setShowTranscript(!showTranscript)}
          >
            <ChevronDown className={`size-3 transition-transform duration-150 ${showTranscript ? "" : "-rotate-90"}`} />
            Transcript ({detail.Segments.length})
          </button>
          {showTranscript && (
            <div className="mt-3 space-y-1.5">
              {retranscribing ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground/50">Re-transcribing...</p>
                </div>
              ) : (
                detail.Segments.map((seg, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="text-[11px] text-muted-foreground/30 tabular-nums shrink-0 pt-0.5 w-14 text-right">
                      {seg.Timestamp}
                    </span>
                    <span className="text-foreground/80 leading-relaxed">{seg.Text}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function HistoryPage() {
  const { session: sessionParam } = Route.useSearch()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(sessionParam ?? null)
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
    return () => { window.waves?.off("recording:stopped", onStopped) }
  }, [fetchSessions])

  useEffect(() => {
    if (sessionParam && sessionParam !== selectedId) {
      setSelectedId(sessionParam)
    }
  }, [sessionParam])

  useEffect(() => {
    if (selectedId) {
      setDetailLoading(true)
      window.waves.getSession(selectedId).then((res) => {
        setDetail(res.Session)
      }).catch((err) => {
        console.error("Failed to get session:", err)
      }).finally(() => {
        setDetailLoading(false)
      })
    }
  }, [selectedId])

  const handleSelect = (id: string) => {
    setSelectedId(id)
    setDetail(null)
  }

  const handleBack = () => {
    setSelectedId(null)
    setDetail(null)
    navigate({ to: "/history", search: {} })
    fetchSessions()
  }

  const handleDeleteFromList = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.ID !== id))
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
          onDelete={handleBack}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold">Meetings</h1>
          <p className="text-xs text-muted-foreground/50 mt-0.5">Your recordings and notes</p>
        </div>
      </div>
      <SessionListView
        sessions={sessions}
        loading={loading}
        onSelect={handleSelect}
        onDelete={handleDeleteFromList}
      />
    </div>
  )
}

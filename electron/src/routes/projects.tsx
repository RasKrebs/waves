import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState, useEffect, useCallback } from "react"
import {
  FolderOpen,
  Plus,
  ChevronRight,
  ArrowLeft,
  Loader2,
  FileText,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { ProjectRow, ProjectDetail, SessionRow } from "../types/waves"

export const Route = createFileRoute("/projects")({
  component: ProjectsPage,
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)

  if (days === 0) return `Today`
  if (days === 1) return `Yesterday`
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
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

function CreateProjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("")
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setCreating(true)
    try {
      await window.waves.createProject(trimmed)
      setName("")
      onCreated()
    } catch (err) {
      console.error("Failed to create project:", err)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="New project name..."
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        className="h-8 text-sm"
        disabled={creating}
      />
      <Button
        size="sm"
        className="h-8 shrink-0"
        onClick={handleCreate}
        disabled={creating || !name.trim()}
      >
        {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        <span className="ml-1.5">Create</span>
      </Button>
    </div>
  )
}

function ProjectListView({
  projects,
  loading,
  onSelect,
  onRefresh,
}: {
  projects: ProjectRow[]
  loading: boolean
  onSelect: (id: string) => void
  onRefresh: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <CreateProjectForm onCreated={onRefresh} />

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <FolderOpen className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No projects yet</p>
          <p className="text-xs text-muted-foreground/60">
            Create a project to organize your meetings and notes.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {projects.map((p) => (
            <button
              key={p.ID}
              onClick={() => onSelect(p.ID)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-muted/50 transition-colors group"
            >
              <FolderOpen className="size-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{p.Name}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs text-muted-foreground">
                    {p.SessionCount} {p.SessionCount === 1 ? "meeting" : "meetings"}
                  </span>
                  <span className="text-xs text-muted-foreground/40">·</span>
                  <span className="text-xs text-muted-foreground">{formatDate(p.CreatedAt)}</span>
                </div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectDetailView({
  project,
  loading,
  onBack,
  onRefresh,
}: {
  project: ProjectDetail | null
  loading: boolean
  onBack: () => void
  onRefresh: () => void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDesc, setEditDesc] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [allSessions, setAllSessions] = useState<SessionRow[]>([])
  const [assigning, setAssigning] = useState(false)
  const [showAssign, setShowAssign] = useState(false)

  // Load unassigned sessions for the assign picker
  useEffect(() => {
    if (showAssign) {
      window.waves.listSessions(100).then((res) => {
        // Show sessions not in any project
        setAllSessions((res.Sessions ?? []).filter((s) => !s.ProjectID))
      }).catch(console.error)
    }
  }, [showAssign])

  if (loading || !project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const handleStartEdit = () => {
    setEditName(project.Name)
    setEditDesc(project.Description)
    setEditing(true)
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      await window.waves.updateProject(project.ID, editName.trim(), editDesc.trim())
      setEditing(false)
      onRefresh()
    } catch (err) {
      console.error("Failed to update project:", err)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await window.waves.deleteProject(project.ID)
      onBack()
    } catch (err) {
      console.error("Failed to delete project:", err)
    } finally {
      setDeleting(false)
    }
  }

  const handleAssign = async (sessionId: string) => {
    setAssigning(true)
    try {
      await window.waves.assignSession(sessionId, project.ID)
      setShowAssign(false)
      onRefresh()
    } catch (err) {
      console.error("Failed to assign session:", err)
    } finally {
      setAssigning(false)
    }
  }

  const handleUnassign = async (sessionId: string) => {
    try {
      await window.waves.assignSession(sessionId, null)
      onRefresh()
    } catch (err) {
      console.error("Failed to unassign session:", err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" className="size-7 mt-0.5" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-lg font-semibold"
                placeholder="Project name"
                onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
              />
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="h-8 text-sm"
                placeholder="Description (optional)"
                onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
              />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" onClick={handleSaveEdit} disabled={saving}>
                  {saving ? <Loader2 className="size-3 animate-spin mr-1" /> : <Check className="size-3 mr-1" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                  <X className="size-3 mr-1" />Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{project.Name}</h2>
                <Button variant="ghost" size="icon" className="size-6" onClick={handleStartEdit}>
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive hover:text-destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                </Button>
              </div>
              {project.Description && (
                <p className="text-sm text-muted-foreground mt-0.5">{project.Description}</p>
              )}
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Meetings in this project */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Meetings ({project.Sessions.length})
          </h3>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowAssign(!showAssign)}>
            <Plus className="size-3 mr-1" />
            Add Meeting
          </Button>
        </div>

        {/* Assign session picker */}
        {showAssign && (
          <div className="mb-3 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-2">Select a meeting to add:</p>
            {allSessions.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">No unassigned meetings available.</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {allSessions.map((s) => (
                  <button
                    key={s.ID}
                    onClick={() => handleAssign(s.ID)}
                    disabled={assigning}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted/50 text-sm disabled:opacity-50"
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{s.Title || "Untitled"}</span>
                    <span className="text-xs text-muted-foreground ml-auto shrink-0">{s.Duration}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {project.Sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <FileText className="size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No meetings in this project yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {project.Sessions.map((s) => (
              <div
                key={s.ID}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group cursor-pointer"
                onClick={() => navigate({ to: "/history", search: { session: s.ID } })}
              >
                <FileText className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{s.Title || "Untitled"}</span>
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => handleUnassign(s.ID)}
                >
                  <X className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true)
      const res = await window.waves.listProjects()
      setProjects(res.Projects ?? [])
    } catch (err) {
      console.error("Failed to list projects:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleSelect = async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    try {
      const res = await window.waves.getProject(id)
      setDetail(res.Project)
    } catch (err) {
      console.error("Failed to get project:", err)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleBack = () => {
    setSelectedId(null)
    setDetail(null)
    fetchProjects()
  }

  const handleRefreshDetail = async () => {
    if (selectedId) {
      try {
        const res = await window.waves.getProject(selectedId)
        setDetail(res.Project)
      } catch (err) {
        console.error("Failed to refresh project:", err)
      }
    }
  }

  if (selectedId) {
    return (
      <div className="flex flex-col h-full p-2">
        <ProjectDetailView
          project={detail}
          loading={detailLoading}
          onBack={handleBack}
          onRefresh={handleRefreshDetail}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-semibold">Projects</h1>
      </div>
      <ProjectListView
        projects={projects}
        loading={loading}
        onSelect={handleSelect}
        onRefresh={fetchProjects}
      />
    </div>
  )
}

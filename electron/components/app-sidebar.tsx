import * as React from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import {
  AudioWaveform,
  Mic,
  Clock,
  Upload,
  Settings,
  FolderOpen,
  RotateCw,
  Circle,
  ChevronRight,
  Plus,
  Square,
  FileText,
} from "lucide-react"

import { SettingsDialog } from "@/components/settings-dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ProjectRow, SessionRow, AudioProcess, Device } from "../src/types/waves"

// ── Daemon state ──

type DaemonState = 'running' | 'stopped' | 'starting'

const stateConfig: Record<DaemonState, { color: string; label: string }> = {
  running: { color: 'text-emerald-500', label: 'Connected' },
  stopped: { color: 'text-red-500', label: 'Disconnected' },
  starting: { color: 'text-amber-500', label: 'Starting' },
}

function useDaemonState() {
  const [state, setState] = React.useState<DaemonState>('starting')

  React.useEffect(() => {
    window.waves?.getDaemonState().then(setState).catch(() => setState('stopped'))

    const handler = (newState: DaemonState) => setState(newState)
    window.waves?.on('daemon:state', handler)
    return () => { window.waves?.off('daemon:state', handler) }
  }, [])

  return state
}

// ── Recording state (shared across sidebar) ──

type RecordingState = 'idle' | 'recording'

function useRecordingState() {
  const [state, setState] = React.useState<RecordingState>('idle')
  const [elapsed, setElapsed] = React.useState(0)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  React.useEffect(() => {
    window.waves?.getStatus().then((status) => {
      if (status.ActiveSession) setState('recording')
    }).catch(() => {})
  }, [])

  React.useEffect(() => {
    const onStarted = () => { setState('recording'); setElapsed(0) }
    const onStopped = () => { setState('idle'); setElapsed(0) }
    window.waves?.on('recording:started', onStarted)
    window.waves?.on('recording:stopped', onStopped)
    return () => {
      window.waves?.off('recording:started', onStarted)
      window.waves?.off('recording:stopped', onStopped)
    }
  }, [])

  React.useEffect(() => {
    if (state === 'recording') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [state])

  return { state, elapsed }
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Inline Recording Controls ──

function RecordingControls({ daemonState }: { daemonState: DaemonState }) {
  const { state: recState, elapsed } = useRecordingState()
  const [starting, setStarting] = React.useState(false)
  const navigate = useNavigate()

  const handleStart = async () => {
    setStarting(true)
    try {
      await window.waves.startRecording("")
    } catch (err) {
      console.error("Failed to start recording:", err)
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      await window.waves.stopRecording()
      navigate({ to: "/history", search: {} })
    } catch (err) {
      console.error("Failed to stop recording:", err)
    }
  }

  if (recState === 'recording') {
    return (
      <button
        onClick={handleStop}
        className="flex items-center gap-2.5 w-full rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-left transition-colors hover:bg-destructive/10"
      >
        <div className="relative flex items-center justify-center">
          <span className="absolute inline-flex size-2.5 rounded-full bg-destructive animate-ping opacity-50" />
          <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs font-medium text-destructive">Recording</span>
          <span className="text-[10px] text-destructive/60 ml-1.5 tabular-nums">{formatElapsed(elapsed)}</span>
        </div>
        <Square className="size-3 text-destructive/60" />
      </button>
    )
  }

  return (
    <button
      onClick={handleStart}
      disabled={daemonState !== 'running' || starting}
      className="flex items-center gap-2.5 w-full rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <div className="flex size-6 items-center justify-center rounded-full bg-primary/10">
        <Mic className="size-3 text-primary" />
      </div>
      <span className="text-xs text-muted-foreground font-medium">
        {starting ? "Starting..." : "Start Recording"}
      </span>
    </button>
  )
}

// ── Project Tree ──

function ProjectTree({
  onSessionSelect,
}: {
  onSessionSelect: (sessionId: string) => void
}) {
  const [projects, setProjects] = React.useState<ProjectRow[]>([])
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [projectSessions, setProjectSessions] = React.useState<Record<string, SessionRow[]>>({})
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  const fetchProjects = React.useCallback(async () => {
    try {
      const res = await window.waves.listProjects()
      setProjects(res.Projects ?? [])
    } catch (err) {
      console.error("Failed to list projects:", err)
    }
  }, [])

  React.useEffect(() => { fetchProjects() }, [fetchProjects])

  // Refresh on recording stop
  React.useEffect(() => {
    const onStopped = () => {
      fetchProjects()
      // Refresh expanded projects
      expanded.forEach((id) => loadProjectSessions(id))
    }
    window.waves?.on('recording:stopped', onStopped)
    return () => { window.waves?.off('recording:stopped', onStopped) }
  }, [fetchProjects, expanded])

  const loadProjectSessions = async (projectId: string) => {
    try {
      const res = await window.waves.getProject(projectId)
      setProjectSessions((prev) => ({ ...prev, [projectId]: res.Project.Sessions ?? [] }))
    } catch (err) {
      console.error("Failed to load project sessions:", err)
    }
  }

  const toggleProject = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        if (!projectSessions[id]) loadProjectSessions(id)
      }
      return next
    })
  }

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      await window.waves.createProject(trimmed)
      setNewName("")
      setCreating(false)
      fetchProjects()
    } catch (err) {
      console.error("Failed to create project:", err)
    }
  }

  React.useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  return (
    <SidebarGroup>
      <div className="flex items-center justify-between pr-2">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <button
          onClick={() => setCreating(!creating)}
          className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <Plus className="size-3" />
        </button>
      </div>
      <SidebarGroupContent>
        {creating && (
          <div className="px-2 pb-1.5">
            <Input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape") { setCreating(false); setNewName("") }
              }}
              onBlur={() => { if (!newName.trim()) setCreating(false) }}
              placeholder="Project name..."
              className="h-6 text-xs px-2 bg-transparent border-muted-foreground/20"
            />
          </div>
        )}
        <SidebarMenu>
          {projects.map((project) => {
            const isOpen = expanded.has(project.ID)
            const sessions = projectSessions[project.ID] ?? []
            return (
              <Collapsible key={project.ID} open={isOpen} onOpenChange={() => toggleProject(project.ID)}>
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton className="gap-1.5">
                      <ChevronRight className={`size-3 text-muted-foreground/50 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
                      <FolderOpen className="size-3.5 text-muted-foreground/70" />
                      <span className="truncate text-xs">{project.Name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/40">{project.SessionCount}</span>
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-5 border-l border-border/40 pl-2 py-0.5">
                      {sessions.length === 0 ? (
                        <p className="text-[10px] text-muted-foreground/40 py-1 px-1">No meetings</p>
                      ) : (
                        sessions.map((session) => (
                          <button
                            key={session.ID}
                            onClick={() => onSessionSelect(session.ID)}
                            className="flex items-center gap-1.5 w-full rounded px-1.5 py-1 text-left hover:bg-muted/50 transition-colors"
                          >
                            <FileText className="size-3 text-muted-foreground/50 shrink-0" />
                            <span className="truncate text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                              {session.Title || "Untitled"}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            )
          })}

          {projects.length === 0 && !creating && (
            <p className="text-[10px] text-muted-foreground/40 py-2 px-3">No projects yet</p>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

// ── Main Sidebar ──

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [logsOpen, setLogsOpen] = React.useState(false)
  const [logs, setLogs] = React.useState<string[]>([])
  const [restarting, setRestarting] = React.useState(false)
  const daemonState = useDaemonState()
  const logsEndRef = React.useRef<HTMLDivElement>(null)

  const openLogs = React.useCallback(async () => {
    const lines = await window.waves?.getDaemonLogs() ?? []
    setLogs(lines)
    setLogsOpen(true)
    requestAnimationFrame(() => logsEndRef.current?.scrollIntoView({ behavior: 'instant' }))
  }, [])

  const handleRestart = React.useCallback(async () => {
    setRestarting(true)
    try { await window.waves?.restartDaemon() } finally { setRestarting(false) }
  }, [])

  const handleSessionSelect = React.useCallback((sessionId: string) => {
    navigate({ to: "/history", search: { session: sessionId } })
  }, [navigate])

  return (
    <>
      <Sidebar variant="inset" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/history" search={{}}>
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <AudioWaveform className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Waves</span>
                    <span className="truncate text-[10px] text-muted-foreground/60">Be present</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {/* Inline recording controls */}
          <div className="px-2 pb-1">
            <RecordingControls daemonState={daemonState} />
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Quick nav */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/history"} tooltip="History">
                    <Link to="/history" search={{}}>
                      <Clock className="size-3.5" />
                      <span>All Meetings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/record"} tooltip="Advanced Recording">
                    <Link to="/record">
                      <Mic className="size-3.5" />
                      <span>Record</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={currentPath === "/upload"} tooltip="Upload">
                    <Link to="/upload">
                      <Upload className="size-3.5" />
                      <span>Upload</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Project tree */}
          <ProjectTree onSessionSelect={handleSessionSelect} />
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" tooltip="View Daemon Logs" onClick={openLogs}>
                <Circle className={`w-1.5 fill-current ${stateConfig[daemonState].color}`} />
                <span className="text-[11px]">{stateConfig[daemonState].label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {daemonState === 'stopped' && (
              <SidebarMenuItem>
                <SidebarMenuButton size="sm" tooltip="Restart Daemon" onClick={handleRestart} disabled={restarting}>
                  <RotateCw className={`size-3 ${restarting ? 'animate-spin' : ''}`} />
                  <span className="text-[11px]">{restarting ? 'Restarting' : 'Restart'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" tooltip="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings className="size-3" />
                <span className="text-[11px]">Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Daemon log viewer */}
      <Sheet open={logsOpen} onOpenChange={setLogsOpen}>
        <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Daemon Logs</SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              <Circle className={`size-2 fill-current ${stateConfig[daemonState].color}`} />
              {stateConfig[daemonState].label}
              {daemonState === 'stopped' && (
                <button
                  onClick={handleRestart}
                  disabled={restarting}
                  className="ml-auto text-xs underline hover:no-underline disabled:opacity-50"
                >
                  {restarting ? 'Restarting' : 'Restart'}
                </button>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
            {logs.length === 0
              ? <p className="text-muted-foreground">No logs yet.</p>
              : logs.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
              ))
            }
            <div ref={logsEndRef} />
          </div>
        </SheetContent>
      </Sheet>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  )
}

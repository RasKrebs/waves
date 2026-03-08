import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  AudioWaveform,
  Mic,
  Clock,
  Upload,
  Bot,
  Settings,
  FolderOpen,
  RotateCw,
  ScrollText,
  Circle,
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

const navMain = [
  { title: "Record", url: "/record", icon: Mic },
  { title: "History", url: "/history", icon: Clock },
  { title: "Upload", url: "/upload", icon: Upload },
]

type DaemonState = 'running' | 'stopped' | 'starting'

const stateConfig: Record<DaemonState, { color: string; label: string }> = {
  running: { color: 'text-emerald-500', label: 'Running' },
  stopped: { color: 'text-red-500', label: 'Stopped' },
  starting: { color: 'text-amber-500', label: 'Starting…' },
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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const currentPath = useRouterState({ select: (s) => s.location.pathname })
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
    // Scroll to bottom after render
    requestAnimationFrame(() => logsEndRef.current?.scrollIntoView({ behavior: 'instant' }))
  }, [])

  const handleRestart = React.useCallback(async () => {
    setRestarting(true)
    try { await window.waves?.restartDaemon() } finally { setRestarting(false) }
  }, [])

  return (
    <>
      <Sidebar variant="inset" {...props}>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/record">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                    <AudioWaveform className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Waves</span>
                    <span className="truncate text-xs">Stop taking notes</span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Recording</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navMain.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={currentPath === item.url} tooltip={item.title}>
                      <Link to={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {/* Daemon status */}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" tooltip="View Daemon Logs" onClick={openLogs}>
                <Circle className={`w-1 fill-current ${stateConfig[daemonState].color}`} />
                <span>{stateConfig[daemonState].label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {daemonState === 'stopped' && (
              <SidebarMenuItem>
                <SidebarMenuButton size="sm" tooltip="Restart Daemon" onClick={handleRestart} disabled={restarting}>
                  <RotateCw className={restarting ? 'animate-spin' : ''} />
                  <span>{restarting ? 'Restarting…' : 'Restart Daemon'}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton size="sm" tooltip="Settings" onClick={() => setSettingsOpen(true)}>
                <Settings />
                <span>Settings</span>
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
                  {restarting ? 'Restarting…' : 'Restart'}
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

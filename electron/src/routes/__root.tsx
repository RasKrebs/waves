import { createRootRoute, Outlet } from "@tanstack/react-router"
import { useState, useEffect } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Loader2, Mic, X, Radio } from "lucide-react"
import type { DetectedMeetingInfo } from "../types/waves"

export const Route = createRootRoute({
  component: RootLayout,
})

function MeetingDetectedBanner() {
  const [meeting, setMeeting] = useState<DetectedMeetingInfo | null>(null)
  const [starting, setStarting] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Check for already-active meeting on mount
    window.waves.getActiveMeeting().then((m) => {
      if (m) setMeeting(m)
    }).catch(() => {})

    const onDetected = (data: DetectedMeetingInfo) => {
      setMeeting(data)
      setDismissed(false)
    }
    const onEnded = () => {
      setMeeting(null)
      setDismissed(false)
    }
    const onRecordingStarted = () => {
      setMeeting(null)
    }

    window.waves.on('meeting:detected', onDetected)
    window.waves.on('meeting:ended', onEnded)
    window.waves.on('recording:started', onRecordingStarted)
    return () => {
      window.waves.off('meeting:detected', onDetected)
      window.waves.off('meeting:ended', onEnded)
      window.waves.off('recording:started', onRecordingStarted)
    }
  }, [])

  if (!meeting || dismissed) return null

  const handleRecord = async () => {
    setStarting(true)
    try {
      await window.waves.startRecording('', { PID: meeting.PID })
    } catch (err) {
      console.error('Failed to start recording:', err)
    } finally {
      setStarting(false)
    }
  }

  const handleDismiss = () => {
    window.waves.dismissMeeting(meeting.PID)
    setDismissed(true)
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 mx-4 mt-1 mb-0">
      <div className="relative flex items-center justify-center shrink-0">
        <span className="absolute inline-flex size-2 rounded-full bg-blue-500 animate-ping opacity-40" />
        <Radio className="size-3.5 text-blue-500 relative" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
          {meeting.AppName} meeting detected
        </span>
      </div>
      <Button
        variant="default"
        size="sm"
        className="h-6 text-[11px] px-2.5"
        onClick={handleRecord}
        disabled={starting}
      >
        {starting ? (
          <Loader2 className="size-3 animate-spin mr-1" />
        ) : (
          <Mic className="size-3 mr-1" />
        )}
        Record
      </Button>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

function RootLayout() {
  return (
    <>
      <div className="bg-sidebar titlebar-drag h-[var(--titlebar-height)] fixed top-0 left-0 right-0 z-[100]" />
      <div className="pt-[var(--titlebar-height)] h-screen flex flex-col overflow-hidden">
        <SidebarProvider className="flex-1 min-h-0">
          <AppSidebar collapsible="icon" />
          <SidebarInset className="flex flex-col min-h-0 max-h-full overflow-hidden">
            <header className="flex h-10 shrink-0 items-center titlebar-no-drag">
              <div className="flex items-center px-3">
                <SidebarTrigger className="-ml-1 size-7" />
              </div>
            </header>
            <MeetingDetectedBanner />
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </>
  )
}

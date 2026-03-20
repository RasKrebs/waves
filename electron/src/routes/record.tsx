import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState, useEffect, useRef, useCallback } from "react"
import { Mic, MicOff, RefreshCw, Monitor, Pencil, SlidersHorizontal } from "lucide-react"
import type { AudioProcess, Device } from "../types/waves"
import { getProcessDisplayName } from "../lib/process-names"

export const Route = createFileRoute("/record")({
  component: RecordPage,
})

type RecordingState = "idle" | "recording"

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
}

/** Minimal waveform dots — Notion-style recording indicator */
function RecordingDots({ active }: { active: boolean }) {
  const [dots, setDots] = useState<number[]>(Array.from({ length: 40 }, () => 0.2))
  const animRef = useRef<number>(0)

  useEffect(() => {
    const animate = () => {
      setDots(prev => prev.map((d) => {
        if (active) {
          const target = 0.15 + Math.random() * 0.85
          return d + (target - d) * 0.12
        }
        return d + (0.15 - d) * 0.08
      }))
      animRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => cancelAnimationFrame(animRef.current)
  }, [active])

  return (
    <div className="flex items-center gap-[3px] h-4">
      {dots.map((d, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-colors duration-300"
          style={{
            height: `${Math.max(3, d * 16)}px`,
            backgroundColor: active
              ? `rgba(255, 255, 255, ${0.3 + d * 0.5})`
              : `rgba(255, 255, 255, 0.1)`,
          }}
        />
      ))}
    </div>
  )
}

type OutputSource = { type: "all" } | { type: "process"; pid: number; name: string }
type InputSource = { type: "none" } | { type: "default" } | { type: "device"; uid: string; name: string }

function RecordPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<RecordingState>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [daemonConnected, setDaemonConnected] = useState(false)
  const [outputSource, setOutputSource] = useState<OutputSource>({ type: "all" })
  const [inputSource, setInputSource] = useState<InputSource>({ type: "default" })
  const [processes, setProcesses] = useState<AudioProcess[]>([])
  const [devices, setDevices] = useState<Device[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    window.waves?.getStatus()
      .then((status) => {
        setDaemonConnected(true)
        if (status.ActiveSession) setState("recording")
      })
      .catch(() => setDaemonConnected(false))
  }, [])

  const refreshSources = useCallback(async () => {
    setRefreshing(true)
    try {
      const [procRes, devRes] = await Promise.all([
        window.waves.listProcesses(),
        window.waves.listDevices(),
      ])
      setProcesses(procRes.Processes ?? [])
      setDevices(devRes.Devices ?? [])
    } catch (err) {
      console.error("Failed to load sources:", err)
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { refreshSources() }, [refreshSources])

  useEffect(() => {
    if (state === "recording") {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [state])

  useEffect(() => {
    const onStarted = () => { setState("recording"); setElapsed(0) }
    const onStopped = () => { setState("idle"); setElapsed(0) }
    window.waves?.on("recording:started", onStarted)
    window.waves?.on("recording:stopped", onStopped)
    return () => {
      window.waves?.off("recording:started", onStarted)
      window.waves?.off("recording:stopped", onStopped)
    }
  }, [])

  const handleRecord = async () => {
    setStarting(true)
    try {
      const opts: { PID?: number; Device?: string; IncludeMic?: boolean } = {}
      if (outputSource.type === "process") opts.PID = outputSource.pid
      if (inputSource.type !== "none") {
        opts.IncludeMic = true
        if (inputSource.type === "device") opts.Device = inputSource.uid
      }
      await window.waves.startRecording("", opts)
      setState("recording")
      setElapsed(0)
    } catch (err) {
      console.error("Failed to start recording:", err)
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      await window.waves.stopRecording()
      setState("idle")
      setElapsed(0)
      navigate({ to: "/history", search: {} })
    } catch (err) {
      console.error("Failed to stop recording:", err)
    }
  }

  const isRecording = state === "recording"
  const activeProcesses = processes.filter(p => p.Active)
  const inputDevices = devices.filter(d => d.UID !== "UID")

  const todayStr = new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })

  return (
    <div className="flex flex-col h-full p-2">
      {/* Notion-style meeting card */}
      <div className="rounded-lg border border-border/60 bg-card max-w-3xl w-full">
        {/* Title bar */}
        <div className="px-5 pt-5 pb-3 border-b border-border/40">
          <h1 className="text-xl font-bold">
            Meeting <span className="text-muted-foreground font-normal">@{todayStr}</span>
          </h1>
        </div>

        {/* Controls bar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border/40">
          <button
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              true ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Pencil className="size-3" />
            Notes
          </button>

          {isRecording && (
            <div className="flex items-center gap-3 flex-1">
              <RecordingDots active={isRecording} />
              <span className="text-xs tabular-nums text-muted-foreground">{formatTime(elapsed)}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => !isRecording && setShowSources(!showSources)}
              disabled={isRecording}
              className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-30"
              title="Audio settings"
            >
              <SlidersHorizontal className="size-4" />
            </button>

            {isRecording ? (
              <button
                onClick={handleStop}
                className="rounded-lg px-4 py-1.5 text-xs font-medium bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleRecord}
                disabled={!daemonConnected || starting}
                className="rounded-lg px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {starting ? "Starting..." : "Start transcribing"}
              </button>
            )}
          </div>
        </div>

        {/* Content area */}
        <div className="px-5 py-4 min-h-[120px]">
          {isRecording ? (
            <p className="text-sm text-muted-foreground/60">
              Recording in progress. Notes will be generated when you stop.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground/40">
              Waves will summarize the notes and transcript
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/40 flex items-center justify-between">
          {!daemonConnected && !isRecording ? (
            <p className="text-[11px] text-destructive/60">Daemon not connected</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/30">
              By starting, you confirm everyone being transcribed has given consent.
            </p>
          )}
          <div className="flex items-center gap-2 text-muted-foreground/30">
            {inputSource.type === "none"
              ? <MicOff className="size-3.5" />
              : <Mic className="size-3.5" />
            }
            <Monitor className="size-3.5" />
          </div>
        </div>
      </div>

      {/* Source selector — shown when clicking settings */}
      {showSources && !isRecording && (
        <div className="rounded-lg border border-border/60 bg-card max-w-3xl w-full mt-3 animate-in slide-in-from-top-2 fade-in-0 duration-200">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Audio Sources</span>
              <button
                onClick={refreshSources}
                disabled={refreshing}
                className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={`size-2.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>

            {/* Output */}
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1 px-1">
                <Monitor className="size-2.5" /> System Audio
              </span>
              <SourcePill
                selected={outputSource.type === "all"}
                onClick={() => setOutputSource({ type: "all" })}
                label="All System Audio"
              />
              {activeProcesses.map((p) => (
                <SourcePill
                  key={p.PID}
                  selected={outputSource.type === "process" && outputSource.pid === p.PID}
                  onClick={() => setOutputSource({ type: "process", pid: p.PID, name: getProcessDisplayName(p.Name) })}
                  label={getProcessDisplayName(p.Name)}
                  meta={`PID ${p.PID}`}
                />
              ))}
              {activeProcesses.length === 0 && (
                <p className="text-[10px] text-muted-foreground/30 px-3 py-1">No active audio sources</p>
              )}
            </div>

            {/* Input */}
            <div className="space-y-1">
              <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider flex items-center gap-1 px-1">
                <Mic className="size-2.5" /> Microphone
              </span>
              <SourcePill
                selected={inputSource.type === "none"}
                onClick={() => setInputSource({ type: "none" })}
                label="No Microphone"
              />
              <SourcePill
                selected={inputSource.type === "default"}
                onClick={() => setInputSource({ type: "default" })}
                label="Default Microphone"
              />
              {inputDevices.map((d) => (
                <SourcePill
                  key={d.UID}
                  selected={inputSource.type === "device" && inputSource.uid === d.UID}
                  onClick={() => setInputSource({ type: "device", uid: d.UID, name: d.Name })}
                  label={d.Name}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SourcePill({
  selected,
  onClick,
  label,
  meta,
}: {
  selected: boolean
  onClick: () => void
  label: string
  meta?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-left transition-all duration-150 text-xs ${
        selected
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground/60 hover:bg-muted/40 hover:text-muted-foreground/80"
      }`}
    >
      <div className={`size-2 rounded-full border transition-all duration-150 ${
        selected ? "border-primary bg-primary" : "border-muted-foreground/20"
      }`} />
      <span className="truncate">{label}</span>
      {meta && <span className="ml-auto text-[10px] text-muted-foreground/30 shrink-0">{meta}</span>}
    </button>
  )
}

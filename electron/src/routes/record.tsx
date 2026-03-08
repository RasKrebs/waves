import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Circle, Square, Pause, Play } from "lucide-react"

export const Route = createFileRoute("/record")({
  component: RecordPage,
})

type RecordingState = "idle" | "recording" | "paused"

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds * 100) % 100)
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${cs.toString().padStart(2, "0")}`
}

function Waveform({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>(Array(80).fill(0))
  const animRef = useRef<number>(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const bars = barsRef.current
    const barCount = bars.length
    const barWidth = 3
    const gap = (w - barCount * barWidth) / (barCount - 1)
    const centerY = h / 2

    ctx.clearRect(0, 0, w, h)

    // Shift bars left and add new one
    if (active) {
      bars.shift()
      const amplitude = 0.15 + Math.random() * 0.7
      bars.push(amplitude)
    } else {
      // Decay existing bars
      for (let i = 0; i < barCount; i++) {
        bars[i] *= 0.95
      }
    }

    for (let i = 0; i < barCount; i++) {
      const x = i * (barWidth + gap)
      const barH = Math.max(2, bars[i] * h * 0.8)

      ctx.fillStyle = active
        ? "rgba(255, 255, 255, 0.8)"
        : "rgba(255, 255, 255, 0.3)"
      ctx.beginPath()
      ctx.roundRect(x, centerY - barH / 2, barWidth, barH, 1.5)
      ctx.fill()
    }

    animRef.current = requestAnimationFrame(draw)
  }, [active])

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ imageRendering: "pixelated" }}
    />
  )
}

function RecordPage() {
  const [state, setState] = useState<RecordingState>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [daemonConnected, setDaemonConnected] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check daemon status on mount
  useEffect(() => {
    window.waves?.getStatus()
      .then((status) => {
        setDaemonConnected(true)
        if (status.ActiveSession) {
          setState("recording")
          setSessionId(status.ActiveSession)
        }
      })
      .catch(() => setDaemonConnected(false))
  }, [])

  // Timer
  useEffect(() => {
    if (state === "recording") {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 0.01)
      }, 10)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [state])

  // Listen for external recording events (tray, meeting detection)
  useEffect(() => {
    const onStarted = () => {
      setState("recording")
      setElapsed(0)
    }
    const onStopped = () => {
      setState("idle")
      setElapsed(0)
      setSessionId(null)
    }
    window.waves?.on("recording:started", onStarted)
    window.waves?.on("recording:stopped", onStopped)
    return () => {
      window.waves?.off("recording:started", onStarted)
      window.waves?.off("recording:stopped", onStopped)
    }
  }, [])

  const handleRecord = async () => {
    try {
      const res = await window.waves.startRecording("")
      setSessionId(res.SessionID)
      setState("recording")
      setElapsed(0)
    } catch (err) {
      console.error("Failed to start recording:", err)
    }
  }

  const handleStop = async () => {
    try {
      await window.waves.stopRecording()
      setState("idle")
      setElapsed(0)
      setSessionId(null)
    } catch (err) {
      console.error("Failed to stop recording:", err)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Waveform area */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        <div className="w-full h-32 px-4">
          <Waveform active={state === "recording"} />
        </div>

        {/* Timeline ticks */}
        {state !== "idle" && (
          <div className="w-full px-4 mt-2">
            <div className="h-px bg-muted-foreground/20 w-full relative">
              <div
                className="absolute top-0 w-0.5 h-3 -translate-y-1/2 bg-blue-500 rounded-full"
                style={{ left: "50%" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Timer + controls */}
      <div className="shrink-0 flex flex-col items-center gap-6 pb-8">
        {/* Timer display */}
        <div className="tabular-nums text-4xl font-light tracking-wider text-foreground/90">
          {formatTime(elapsed)}
        </div>

        {/* Control buttons */}
        <div className="flex items-center gap-6">
          {state === "idle" ? (
            <Button
              size="lg"
              className="h-16 w-16 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-900/30"
              onClick={handleRecord}
              disabled={!daemonConnected}
            >
              <Circle className="size-6 fill-current" />
            </Button>
          ) : (
            <>
              <Button
                size="lg"
                variant="outline"
                className="h-12 w-12 rounded-full"
                onClick={handleStop}
              >
                <Square className="size-4 fill-current" />
              </Button>
              <Button
                size="lg"
                className={`h-16 w-16 rounded-full shadow-lg ${
                  state === "recording"
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-red-900/30 animate-pulse"
                    : "bg-red-600 hover:bg-red-700 text-white shadow-red-900/30"
                }`}
                disabled
              >
                {state === "recording" ? (
                  <Pause className="size-6 fill-current" />
                ) : (
                  <Play className="size-6 fill-current ml-0.5" />
                )}
              </Button>
            </>
          )}
        </div>

        {/* Status line */}
        <p className="text-xs text-muted-foreground">
          {!daemonConnected
            ? "Daemon not connected — run make build first"
            : state === "idle"
              ? "Ready to record"
              : state === "recording"
                ? "Recording..."
                : "Paused"}
        </p>
      </div>
    </div>
  )
}

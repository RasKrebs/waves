import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useRef, useCallback } from "react"
import { Square } from "lucide-react"

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

const RING_COUNT = 6
const ACCENT = [96, 165, 250] // blue-400

function CoreCanvas({
  active,
  hover,
}: {
  active: boolean
  hover: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const levelRef = useRef(0)
  const ringsRef = useRef<number[]>(Array(RING_COUNT).fill(0))
  const phaseRef = useRef(0)

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
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.min(w, h) / 2

    ctx.clearRect(0, 0, w, h)

    // Simulate audio level with smoothed noise
    const target = active ? 0.3 + Math.random() * 0.7 : 0
    levelRef.current += (target - levelRef.current) * 0.12
    const level = levelRef.current

    phaseRef.current += 0.02

    // Update ring amplitudes (each ring reacts with slight delay)
    const rings = ringsRef.current
    for (let i = 0; i < RING_COUNT; i++) {
      const delayed = level * (1 - i * 0.1)
      rings[i] += (Math.max(0, delayed) - rings[i]) * (0.15 - i * 0.015)
    }

    // Draw rings from outermost to innermost
    for (let i = RING_COUNT - 1; i >= 0; i--) {
      const t = i / RING_COUNT
      const baseR = maxR * 0.25 + maxR * 0.55 * t
      const pulse = rings[i] * maxR * 0.12
      const wobble =
        Math.sin(phaseRef.current * (1.5 + i * 0.3) + i * 1.2) *
        rings[i] *
        maxR *
        0.04
      const r = baseR + pulse + wobble

      const alpha = active
        ? 0.08 + rings[i] * 0.25
        : hover
          ? 0.06
          : 0.03

      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(0, r), 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${alpha})`
      ctx.lineWidth = 1.5 + rings[i] * 2
      ctx.stroke()
    }

    // Inner glow
    const glowR = maxR * 0.22 + level * maxR * 0.06
    const glowAlpha = active ? 0.12 + level * 0.2 : hover ? 0.06 : 0.03
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR * 2.5)
    grad.addColorStop(
      0,
      `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${glowAlpha})`,
    )
    grad.addColorStop(1, `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, 0)`)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)

    // Core circle
    const coreR = maxR * 0.18 + level * maxR * 0.04
    const coreAlpha = active ? 0.6 + level * 0.35 : hover ? 0.3 : 0.15
    const coreGrad = ctx.createRadialGradient(
      cx,
      cy,
      0,
      cx,
      cy,
      coreR,
    )
    coreGrad.addColorStop(
      0,
      `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${coreAlpha})`,
    )
    coreGrad.addColorStop(
      0.7,
      `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, ${coreAlpha * 0.5})`,
    )
    coreGrad.addColorStop(
      1,
      `rgba(${ACCENT[0]}, ${ACCENT[1]}, ${ACCENT[2]}, 0)`,
    )
    ctx.beginPath()
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2)
    ctx.fillStyle = coreGrad
    ctx.fill()

    animRef.current = requestAnimationFrame(draw)
  }, [active, hover])

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [draw])

  return (
    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
  )
}

function RecordPage() {
  const [state, setState] = useState<RecordingState>("idle")
  const [elapsed, setElapsed] = useState(0)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [daemonConnected, setDaemonConnected] = useState(false)
  const [hover, setHover] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const isRecording = state === "recording"

  return (
    <div className="flex flex-col h-full items-center justify-center gap-6 p-6">
      {/* Core visualization square */}
      <button
        className="relative aspect-square w-full max-w-[320px] rounded-2xl border border-border/50 bg-card/50 overflow-hidden cursor-pointer transition-colors hover:border-border disabled:cursor-not-allowed disabled:opacity-50"
        onClick={isRecording ? handleStop : handleRecord}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        disabled={!daemonConnected}
      >
        <CoreCanvas active={isRecording} hover={hover} />

        {/* Center icon overlay */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {isRecording ? (
            <Square className="size-5 text-blue-400/80 fill-blue-400/80" />
          ) : (
            <div className="size-4 rounded-full bg-blue-400/60" />
          )}
        </div>
      </button>

      {/* Timer + status */}
      <div className="flex flex-col items-center gap-2">
        <div className="tabular-nums text-3xl font-light tracking-wider text-foreground/90">
          {formatTime(elapsed)}
        </div>
        <p className="text-xs text-muted-foreground">
          {!daemonConnected
            ? "Daemon not connected"
            : isRecording
              ? "Recording..."
              : "Ready to record"}
        </p>
      </div>
    </div>
  )
}

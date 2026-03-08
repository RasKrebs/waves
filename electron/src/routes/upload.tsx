import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Upload, FileAudio, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const Route = createFileRoute("/upload")({
  component: UploadPage,
})

function UploadPage() {
  const navigate = useNavigate()
  const [filePath, setFilePath] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [transcribing, setTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = async () => {
    try {
      const path = await window.waves.uploadPick()
      if (path) {
        setFilePath(path)
        setError(null)
        // Pre-fill title from filename
        if (!title) {
          const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? ""
          setTitle(name)
        }
      }
    } catch (err) {
      console.error("Failed to pick file:", err)
    }
  }

  const handleTranscribe = async () => {
    if (!filePath) return
    setTranscribing(true)
    setError(null)
    try {
      await window.waves.uploadTranscribe(filePath, title || "Uploaded recording")
      navigate({ to: "/history" })
    } catch (err: any) {
      setError(err?.message ?? "Transcription failed")
    } finally {
      setTranscribing(false)
    }
  }

  const handleClear = () => {
    setFilePath(null)
    setTitle("")
    setError(null)
  }

  const fileName = filePath?.split("/").pop()

  return (
    <div className="flex flex-col h-full items-center justify-center p-8">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-lg font-semibold">Upload Recording</h1>
          <p className="text-sm text-muted-foreground">
            Transcribe an existing audio file.
          </p>
        </div>

        {/* File picker area */}
        {!filePath ? (
          <button
            onClick={handlePick}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/20 p-10 hover:border-muted-foreground/40 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <Upload className="size-8 text-muted-foreground/40" />
            <div className="text-center">
              <p className="text-sm font-medium">Choose audio file</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                WAV, MP3, M4A, OGG, FLAC, WebM
              </p>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
            <FileAudio className="size-5 text-muted-foreground shrink-0" />
            <span className="text-sm truncate flex-1">{fileName}</span>
            <Button variant="ghost" size="icon" className="size-6 shrink-0" onClick={handleClear}>
              <X className="size-3.5" />
            </Button>
          </div>
        )}

        {/* Title + submit */}
        {filePath && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="title" className="text-sm">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Session title"
                className="h-8 text-sm"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              className="w-full"
              onClick={handleTranscribe}
              disabled={transcribing}
            >
              {transcribing ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Transcribing...
                </>
              ) : (
                "Transcribe"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

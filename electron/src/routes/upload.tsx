import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/upload")({
  component: UploadPage,
})

function UploadPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Upload</h1>
      <p className="text-muted-foreground">Upload audio files for transcription.</p>
    </div>
  )
}

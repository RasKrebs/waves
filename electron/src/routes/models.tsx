import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/models")({
  component: ModelsPage,
})

function ModelsPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Models</h1>
      <p className="text-muted-foreground">Model management will go here.</p>
    </div>
  )
}

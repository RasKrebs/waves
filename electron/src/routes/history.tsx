import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

function HistoryPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="text-muted-foreground">Past sessions will go here.</p>
    </div>
  )
}

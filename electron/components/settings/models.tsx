import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useCallback } from "react"
import { Bot, Check, Loader2, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ModelRow } from "@/src/types/waves"

export const Route = createFileRoute("/models")({
    component: ModelsPage,
})

export function ModelsPage() {
    const [models, setModels] = useState<ModelRow[]>([])
    const [loading, setLoading] = useState(true)
    const [setting, setSetting] = useState<string | null>(null)
    const [pullRepo, setPullRepo] = useState("")
    const [pulling, setPulling] = useState(false)
    const [pullError, setPullError] = useState<string | null>(null)

    const fetchModels = useCallback(async () => {
        try {
            setLoading(true)
            const res = await window.waves.listModels()
            setModels(res.Models ?? [])
        } catch (err) {
            console.error("Failed to list models:", err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchModels()
    }, [fetchModels])

    const handleSetModel = async (name: string) => {
        setSetting(name)
        try {
            await window.waves.setModel(name)
            setModels((prev) => prev.map((m) => ({ ...m, Active: m.Name === name })))
        } catch (err) {
            console.error("Failed to set model:", err)
        } finally {
            setSetting(null)
        }
    }

    const handlePull = async () => {
        if (!pullRepo.trim()) return
        setPulling(true)
        setPullError(null)
        try {
            await window.waves.pullModel(pullRepo.trim())
            setPullRepo("")
            await fetchModels()
        } catch (err: any) {
            setPullError(err?.message ?? "Failed to download model")
        } finally {
            setPulling(false)
        }
    }

    return (
        <div className="pt-2">

            {/* Pull new model */}
            <div className="flex items-center gap-2 mb-4">
                <Input
                    placeholder="HuggingFace repo (e.g. ggerganov/whisper.cpp)"
                    value={pullRepo}
                    onChange={(e) => setPullRepo(e.target.value)}
                    className="h-8 text-sm flex-1"
                    onKeyDown={(e) => e.key === "Enter" && handlePull()}
                />
                <Button size="sm" variant="outline" onClick={handlePull} disabled={pulling || !pullRepo.trim()}>
                    {pulling ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                    <span className="ml-1.5">Pull</span>
                </Button>
            </div>
            {pullError && <p className="text-xs text-destructive mb-3">{pullError}</p>}

            {/* Model list */}
            {loading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
            ) : models.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
                    <Bot className="size-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">No models installed</p>
                    <p className="text-xs text-muted-foreground/60">
                        Pull a whisper.cpp model from HuggingFace to get started.
                    </p>
                </div>
            ) : (
                <div className="space-y-1">
                    {models.map((m) => (
                        <div
                            key={m.Name}
                            className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium">{m.Name}</span>
                                    {m.Active && (
                                        <span className="inline-flex items-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 text-[10px] font-medium">
                                            active
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-muted-foreground">{m.Type}</span>
                                    {m.Size && (
                                        <>
                                            <span className="text-xs text-muted-foreground/40">·</span>
                                            <span className="text-xs text-muted-foreground">{m.Size}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            {!m.Active && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={setting === m.Name}
                                    onClick={() => handleSetModel(m.Name)}
                                >
                                    {setting === m.Name ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                        <Check className="size-3" />
                                    )}
                                    <span className="ml-1">Use</span>
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

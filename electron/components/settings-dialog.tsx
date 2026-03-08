import { useState, useEffect, useCallback } from "react"
import { Loader2, Download } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTheme } from "./theme-provider"
import type { ModelRow } from "../src/types/waves"
import { ModelsPage } from "./settings/models"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-8 py-3">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SettingBlock({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="py-3 space-y-2">
      <div className="space-y-0.5">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  )
}

function HuggingFaceModelSection({
  models,
  activeModel,
  onSelectModel,
  onPull,
}: {
  models: ModelRow[]
  activeModel: string
  onSelectModel: (name: string) => void
  onPull: (repo: string) => Promise<void>
}) {
  const [pullRepo, setPullRepo] = useState("")
  const [pulling, setPulling] = useState(false)
  const [pullError, setPullError] = useState<string | null>(null)

  const hfModels = models.filter((m) => m.Type === "transformers")

  const handlePull = async () => {
    if (!pullRepo.trim()) return
    setPulling(true)
    setPullError(null)
    try {
      await onPull(pullRepo.trim())
      setPullRepo("")
    } catch (err: any) {
      setPullError(err?.message ?? "Download failed")
    } finally {
      setPulling(false)
    }
  }

  return (
    <SettingBlock
      label="HuggingFace Model"
      description="Download and use any Whisper-compatible model"
    >
      <div className="flex items-center gap-2">
        <Input
          placeholder="e.g. syvai/hviske-v3-conversation"
          value={pullRepo}
          onChange={(e) => setPullRepo(e.target.value)}
          className="h-8 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && handlePull()}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={handlePull}
          disabled={pulling || !pullRepo.trim()}
        >
          {pulling ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          <span className="ml-1.5">Pull</span>
        </Button>
      </div>
      {pullError && <p className="text-xs text-destructive">{pullError}</p>}

      {hfModels.length > 0 && (
        <div className="space-y-1 mt-1">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Downloaded</p>
          {hfModels.map((m) => {
            const isActive = activeModel === m.Name
            return (
              <button
                key={m.Name}
                onClick={() => onSelectModel(m.Name)}
                className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors ${isActive ? "bg-primary/10 border border-primary/20" : "bg-muted/40 hover:bg-muted/60"
                  }`}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{m.Name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.Size}</p>
                </div>
                {isActive && (
                  <span className="text-[10px] text-green-600 dark:text-green-400 font-medium shrink-0 ml-2">active</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </SettingBlock>
  )
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme()
  const [models, setModels] = useState<ModelRow[]>([])
  const [transcriptionProvider, setTranscriptionProvider] = useState("whisper-local")
  const [transcriptionModel, setTranscriptionModel] = useState("")
  const [language, setLanguage] = useState("")
  const [summarizationProvider, setSummarizationProvider] = useState("claude")
  const [workflows, setWorkflows] = useState<string[]>([])

  // API keys (local state, saved on blur)
  const [openaiTransKey, setOpenaiTransKey] = useState("")
  const [deepgramKey, setDeepgramKey] = useState("")
  const [claudeKey, setClaudeKey] = useState("")
  const [openaiLlmKey, setOpenaiLlmKey] = useState("")

  const refreshModels = useCallback(() => {
    window.waves?.listModels()
      .then((res) => setModels(res.Models ?? []))
      .catch(() => { })
  }, [])

  useEffect(() => {
    if (!open) return
    window.waves?.getConfig()
      .then((c) => {
        const parts = c.TranscriptionProvider?.split("|") ?? ["whisper-local"]
        setTranscriptionProvider(parts[0])
        setTranscriptionModel(parts[1] ?? "")
        setLanguage(c.TranscriptionLanguage ?? "")
        setSummarizationProvider(c.SummarizationProvider?.split("|")[0] ?? "claude")
        setWorkflows(c.Workflows ?? [])
      })
      .catch(() => { })
    refreshModels()
  }, [open, refreshModels])

  // Persist a config change to the backend
  const saveConfig = useCallback((changes: Record<string, unknown>) => {
    window.waves?.setConfig(changes).catch((err) =>
      console.error("Failed to save config:", err)
    )
  }, [])

  const handleTranscriptionProviderChange = (provider: string) => {
    setTranscriptionProvider(provider)
    setTranscriptionModel("")
    // For providers that need a model selected, don't save yet
    if (provider === "huggingface") return
    saveConfig({ transcription: { provider } })
  }

  const handleTranscriptionModelChange = (model: string) => {
    setTranscriptionModel(model)
    const spec = model ? `${transcriptionProvider}|${model}` : transcriptionProvider
    saveConfig({ transcription: { provider: spec } })
  }

  const handleLanguageChange = (lang: string) => {
    setLanguage(lang)
    saveConfig({ transcription: { language: lang } })
  }

  const handleSummarizationProviderChange = (provider: string) => {
    setSummarizationProvider(provider)
    saveConfig({ summarization: { provider } })
  }

  const handleApiKeySave = (section: string, subsection: string, key: string) => {
    if (!key) return
    saveConfig({ [section]: { [subsection]: { api_key: key } } })
  }

  const handlePull = async (repo: string) => {
    await window.waves.pullModel(repo)
    refreshModels()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90%] max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 min-h-0">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="transcription">Transcription</TabsTrigger>
            <TabsTrigger value="summarization">Summarization</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
          </TabsList>

          {/* ── General ── */}
          <TabsContent value="general" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow label="Appearance" description="Switch between light and dark mode">
              <Select value={theme} onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow label="Language" description="Primary language for transcription">
              <Select value={language || "en"} onValueChange={handleLanguageChange}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="da">Danish</SelectItem>
                  <SelectItem value="no">Norwegian</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow label="Auto-record meetings" description="Start recording when a meeting app is detected">
              <Switch />
            </SettingRow>
            <Separator />
            <SettingRow label="Launch at login" description="Start Waves when you log in">
              <Switch />
            </SettingRow>
            <Separator />
            <SettingRow label="Data location" description="~/Library/Application Support/Waves">
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => window.waves?.openDataDir()}
              >
                Open
              </button>
            </SettingRow>
          </TabsContent>

          {/* ── Transcription ── */}
          <TabsContent value="transcription" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow label="Provider" description="Backend used for speech-to-text">
              <Select value={transcriptionProvider} onValueChange={handleTranscriptionProviderChange}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whisper-local">Whisper (local)</SelectItem>
                  <SelectItem value="huggingface">HuggingFace</SelectItem>
                  <SelectItem value="openai">OpenAI API</SelectItem>
                  <SelectItem value="deepgram">Deepgram API</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            {transcriptionProvider === "whisper-local" && (() => {
              const ggufModels = models.filter((m) => m.Type === "whisper.cpp")
              return (
                <SettingRow label="Model" description="Whisper model for local transcription">
                  <Select
                    value={transcriptionModel || ggufModels.find((m) => m.Active)?.Name || "base"}
                    onValueChange={handleTranscriptionModelChange}
                  >
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ggufModels.length > 0
                        ? ggufModels.map((m) => (
                          <SelectItem key={m.Name} value={m.Name}>{m.Name}</SelectItem>
                        ))
                        : <>
                          <SelectItem value="tiny">tiny</SelectItem>
                          <SelectItem value="base">base</SelectItem>
                          <SelectItem value="small">small</SelectItem>
                          <SelectItem value="medium">medium</SelectItem>
                          <SelectItem value="large">large-v3</SelectItem>
                        </>
                      }
                    </SelectContent>
                  </Select>
                </SettingRow>
              )
            })()}

            {transcriptionProvider === "huggingface" && (
              <HuggingFaceModelSection
                models={models}
                activeModel={transcriptionModel}
                onSelectModel={handleTranscriptionModelChange}
                onPull={handlePull}
              />
            )}

            {transcriptionProvider === "openai" && (
              <>
                <SettingRow label="Model" description="OpenAI Whisper model">
                  <Select
                    value={transcriptionModel || "whisper-1"}
                    onValueChange={handleTranscriptionModelChange}
                  >
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whisper-1">whisper-1</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <Separator />
                <SettingRow label="API key" description="Required for OpenAI transcription">
                  <Input
                    type="password"
                    placeholder="sk-..."
                    value={openaiTransKey}
                    onChange={(e) => setOpenaiTransKey(e.target.value)}
                    onBlur={() => handleApiKeySave("transcription", "openai", openaiTransKey)}
                    className="w-[160px] h-8 text-xs"
                  />
                </SettingRow>
              </>
            )}

            {transcriptionProvider === "deepgram" && (
              <>
                <SettingRow label="Model" description="Deepgram model">
                  <Select
                    value={transcriptionModel || "nova-2"}
                    onValueChange={handleTranscriptionModelChange}
                  >
                    <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nova-2">nova-2</SelectItem>
                      <SelectItem value="nova-2-general">nova-2-general</SelectItem>
                      <SelectItem value="whisper-large">whisper-large</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <Separator />
                <SettingRow label="API key" description="Required for Deepgram transcription">
                  <Input
                    type="password"
                    placeholder="dg-..."
                    value={deepgramKey}
                    onChange={(e) => setDeepgramKey(e.target.value)}
                    onBlur={() => handleApiKeySave("transcription", "deepgram", deepgramKey)}
                    className="w-[160px] h-8 text-xs"
                  />
                </SettingRow>
              </>
            )}
          </TabsContent>

          {/* ── Summarization ── */}
          <TabsContent value="summarization" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow label="Provider" description="LLM used for generating summaries">
              <Select defaultValue="ollama" value={summarizationProvider} onValueChange={handleSummarizationProviderChange}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="ollama">Ollama (local)</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />

            {summarizationProvider === "claude" && (
              <SettingRow label="API key" description="Required for Claude summarization">
                <Input
                  type="password"
                  placeholder="sk-ant-..."
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                  onBlur={() => handleApiKeySave("summarization", "claude", claudeKey)}
                  className="w-[160px] h-8 text-xs"
                />
              </SettingRow>
            )}

            {summarizationProvider === "openai" && (
              <SettingRow label="API key" description="Required for OpenAI summarization">
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={openaiLlmKey}
                  onChange={(e) => setOpenaiLlmKey(e.target.value)}
                  onBlur={() => handleApiKeySave("summarization", "openai", openaiLlmKey)}
                  className="w-[160px] h-8 text-xs"
                />
              </SettingRow>
            )}

            {summarizationProvider === "ollama" && (
              <SettingRow label="Model" description="Ollama model name">
                <Input
                  defaultValue="llama3.2"
                  className="w-[160px] h-8 text-xs"
                  onBlur={(e) => {
                    const model = e.target.value.trim()
                    if (model) saveConfig({ summarization: { provider: `ollama|${model}` } })
                  }}
                />
              </SettingRow>
            )}

            <Separator />
            <SettingRow label="Workflow" description="Summary pipeline to use">
              <Select defaultValue="default">
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  {workflows.filter((w) => w !== "default").map((w) => (
                    <SelectItem key={w} value={w}>{w}</SelectItem>
                  ))}
                  <SelectItem value="action-items">Action Items</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </TabsContent>
          <TabsContent value="models" className="overflow-y-auto mt-4 space-y-1">
            <ModelsPage />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

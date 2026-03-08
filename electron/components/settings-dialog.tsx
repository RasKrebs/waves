import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
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

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[550px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 min-h-0">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="transcription">Transcription</TabsTrigger>
            <TabsTrigger value="summarization">Summarization</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow
              label="Language"
              description="Primary language for transcription"
            >
              <Select defaultValue="en">
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="no">Norwegian</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow
              label="Auto-record meetings"
              description="Start recording when a meeting app is detected"
            >
              <Switch />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Launch at login"
              description="Start Waves when you log in"
            >
              <Switch />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Data location"
              description="~/Library/Application Support/Waves"
            >
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => {/* TODO: window.waves.openDataDir() */}}
              >
                Open
              </button>
            </SettingRow>
          </TabsContent>

          <TabsContent value="transcription" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow
              label="Provider"
              description="Backend used for speech-to-text"
            >
              <Select defaultValue="whisper-local">
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whisper-local">Whisper (local)</SelectItem>
                  <SelectItem value="command">Custom command</SelectItem>
                  <SelectItem value="openai">OpenAI API</SelectItem>
                  <SelectItem value="deepgram">Deepgram API</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow
              label="Model"
              description="Whisper model to use for local transcription"
            >
              <Select defaultValue="base">
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tiny">tiny</SelectItem>
                  <SelectItem value="base">base</SelectItem>
                  <SelectItem value="small">small</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="large">large-v3</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow
              label="OpenAI API key"
              description="Required for OpenAI transcription"
            >
              <Input
                type="password"
                placeholder="sk-..."
                className="w-[160px] h-8 text-xs"
              />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Deepgram API key"
              description="Required for Deepgram transcription"
            >
              <Input
                type="password"
                placeholder="dg-..."
                className="w-[160px] h-8 text-xs"
              />
            </SettingRow>
          </TabsContent>

          <TabsContent value="summarization" className="overflow-y-auto mt-4 space-y-1">
            <SettingRow
              label="Provider"
              description="LLM used for generating summaries"
            >
              <Select defaultValue="claude">
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="llama-local">Llama (local)</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <Separator />
            <SettingRow
              label="Claude API key"
              description="Required for Claude summarization"
            >
              <Input
                type="password"
                placeholder="sk-ant-..."
                className="w-[160px] h-8 text-xs"
              />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Workflow"
              description="Summary pipeline to use"
            >
              <Select defaultValue="default">
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default</SelectItem>
                  <SelectItem value="detailed">Detailed</SelectItem>
                  <SelectItem value="action-items">Action Items</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useEffect, useCallback, useRef } from "react"
import { Plus, Pencil, Trash2, Loader2, Check, X, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { NoteTemplate } from "@/src/types/waves"

// Built-in templates that can't be deleted
const BUILTIN_KEYS = new Set(["general-meeting", "standup"])

export function TemplatesPage() {
  const [templates, setTemplates] = useState<NoteTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null) // template key being edited
  const [creating, setCreating] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      setLoading(true)
      const res = await window.waves.listNoteTemplates(true)
      setTemplates(res.Templates ?? [])
    } catch (err) {
      console.error("Failed to list templates:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">
            Templates define how meeting notes are structured. Use variables like{" "}
            <code className="text-[10px] bg-muted px-1 rounded">{"{{.Title}}"}</code>,{" "}
            <code className="text-[10px] bg-muted px-1 rounded">{"{{.Date}}"}</code>,{" "}
            <code className="text-[10px] bg-muted px-1 rounded">{"{{.Duration}}"}</code>{" "}
            and HTML comments as fill instructions for the AI.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={() => setCreating(true)}
          disabled={creating}
        >
          <Plus className="size-3 mr-1" />
          New Template
        </Button>
      </div>

      {creating && (
        <TemplateForm
          onSave={async (key, name, desc, content) => {
            await window.waves.createNoteTemplate(key, name, desc, content)
            setCreating(false)
            fetchTemplates()
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      <div className="space-y-2">
        {templates.map((tmpl) => (
          <div key={tmpl.Key}>
            {editing === tmpl.Key ? (
              <TemplateForm
                initial={tmpl}
                onSave={async (_key, name, desc, content) => {
                  await window.waves.updateNoteTemplate(tmpl.Key, name, desc, content)
                  setEditing(null)
                  fetchTemplates()
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <TemplateCard
                template={tmpl}
                isBuiltin={BUILTIN_KEYS.has(tmpl.Key)}
                onEdit={() => setEditing(tmpl.Key)}
                onDelete={async () => {
                  await window.waves.deleteNoteTemplate(tmpl.Key)
                  fetchTemplates()
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  isBuiltin,
  onEdit,
  onDelete,
}: {
  template: NoteTemplate
  isBuiltin: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await onDelete()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <FileText className="size-3.5 text-muted-foreground/60 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{template.Name}</span>
          {isBuiltin && (
            <span className="ml-1.5 text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded">
              built-in
            </span>
          )}
          {template.Description && (
            <p className="text-xs text-muted-foreground truncate">{template.Description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onEdit}
          >
            <Pencil className="size-3" />
          </Button>
          {!isBuiltin && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            </Button>
          )}
        </div>
      </div>

      <button
        className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide preview" : "Show preview"}
      </button>

      {expanded && template.Template && (
        <pre className="text-[11px] text-muted-foreground bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
          {template.Template}
        </pre>
      )}
    </div>
  )
}

function TemplateForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: NoteTemplate
  onSave: (key: string, name: string, description: string, template: string) => Promise<void>
  onCancel: () => void
}) {
  const [key, setKey] = useState(initial?.Key ?? "")
  const [name, setName] = useState(initial?.Name ?? "")
  const [description, setDescription] = useState(initial?.Description ?? "")
  const [template, setTemplate] = useState(initial?.Template ?? DEFAULT_TEMPLATE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // Auto-generate key from name
  const handleNameChange = (value: string) => {
    setName(value)
    if (!initial) {
      const slug = value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
      setKey(slug)
    }
  }

  const handleSave = async () => {
    if (!key.trim() || !name.trim() || !template.trim()) {
      setError("Name and template content are required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(key.trim(), name.trim(), description.trim(), template)
    } catch (err: any) {
      setError(err?.message ?? "Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] text-muted-foreground font-medium">Name</label>
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="e.g. Sprint Retrospective"
            className="h-7 text-xs mt-0.5"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted-foreground font-medium">Key</label>
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="e.g. sprint-retro"
            className="h-7 text-xs mt-0.5"
            disabled={!!initial}
          />
        </div>
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground font-medium">Description</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Brief description of when to use this template"
          className="h-7 text-xs mt-0.5"
        />
      </div>
      <div>
        <label className="text-[11px] text-muted-foreground font-medium">Template (Markdown)</label>
        <Textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="mt-0.5 text-xs font-mono min-h-[180px]"
          placeholder="# {{.Title}}&#10;&#10;**Date:** {{.Date}}&#10;..."
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-1.5 justify-end">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs"
          onClick={handleSave}
          disabled={saving || !name.trim() || !template.trim()}
        >
          {saving ? <Loader2 className="size-3 animate-spin mr-1" /> : <Check className="size-3 mr-1" />}
          {initial ? "Update" : "Create"}
        </Button>
      </div>
    </div>
  )
}

const DEFAULT_TEMPLATE = `# {{.Title}}

**Date:** {{.Date}}
**Duration:** {{.Duration}}

## Attendees
<!-- List participants mentioned in the transcript -->

## Key Points
<!-- The most important information shared -->

## Action Items
- [ ] <!-- Task — Owner — Deadline if mentioned -->

## Notes
<!-- Any additional context or details worth capturing -->
`

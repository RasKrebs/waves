import { useState, useRef, useCallback, useEffect } from "react"
import { Sparkles, Check, X, Loader2, Wand2, SpellCheck, MessageSquare, Copy, Type } from "lucide-react"
import ReactMarkdown from "react-markdown"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu"
import type { NoteView, EditChange } from "../src/types/waves"

interface NoteEditorProps {
  note: NoteView
  onContentUpdate: (noteId: string, content: string) => void
}

/** Floating input for custom AI instructions */
function AiInputOverlay({
  position,
  onSubmit,
  onClose,
  loading,
}: {
  position: { x: number; y: number }
  onSubmit: (instruction: string) => void
  onClose: () => void
  loading: boolean
}) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div
      className="fixed z-50 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ top: position.y, left: position.x }}
    >
      <div className="flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-lg min-w-[280px]">
        <Sparkles className="size-3.5 text-muted-foreground ml-1.5 shrink-0" />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim())
            if (e.key === "Escape") onClose()
          }}
          placeholder="Tell AI what to change..."
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent"
          disabled={loading}
        />
        {loading ? (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground mr-1.5 shrink-0" />
        ) : (
          <button
            onClick={() => value.trim() && onSubmit(value.trim())}
            className="text-muted-foreground hover:text-foreground mr-1 shrink-0"
          >
            <Check className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/** Diff review bar — appears above note content when changes are proposed */
function DiffBar({
  changes,
  onAccept,
  onReject,
  onAcceptAll,
  onDismiss,
}: {
  changes: EditChange[]
  onAccept: (index: number) => void
  onReject: (index: number) => void
  onAcceptAll: () => void
  onDismiss: () => void
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-2 space-y-1.5 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">
          {changes.length} suggested {changes.length === 1 ? "change" : "changes"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={onAcceptAll}>
            <Check className="size-2.5 mr-0.5" /> Accept all
          </Button>
          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5" onClick={onDismiss}>
            <X className="size-2.5" />
          </Button>
        </div>
      </div>
      {changes.map((change, i) => (
        <div key={i} className="flex items-start gap-2 text-xs py-1 border-t border-border/30">
          <div className="flex-1 min-w-0 space-y-0.5">
            <span className="bg-red-500/8 text-red-600 dark:text-red-400 line-through rounded px-0.5">
              {change.Original}
            </span>
            <br />
            <span className="bg-green-500/8 text-green-600 dark:text-green-400 rounded px-0.5">
              {change.Proposed}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 pt-0.5">
            <button
              onClick={() => onAccept(i)}
              className="size-4 flex items-center justify-center rounded hover:bg-green-500/10 text-green-600"
            >
              <Check className="size-2.5" />
            </button>
            <button
              onClick={() => onReject(i)}
              className="size-4 flex items-center justify-center rounded hover:bg-red-500/10 text-red-500"
            >
              <X className="size-2.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function NoteEditor({ note, onContentUpdate }: NoteEditorProps) {
  const [content, setContent] = useState(note.Content)
  const [selectedText, setSelectedText] = useState("")
  const [loading, setLoading] = useState(false)
  const [changes, setChanges] = useState<EditChange[]>([])
  const [aiInput, setAiInput] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => { setContent(note.Content) }, [note.Content])

  // Capture selection before context menu opens
  const captureSelection = useCallback(() => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) {
      setSelectedText(sel.toString().trim())
    } else {
      setSelectedText("")
    }
  }, [])

  const runAiEdit = async (instruction: string) => {
    if (!selectedText) return
    setLoading(true)
    setAiInput(null)
    try {
      const res = await window.waves.editNote(note.ID, selectedText, instruction)
      setChanges(res.Changes ?? [])
    } catch (err) {
      console.error("AI edit failed:", err)
    } finally {
      setLoading(false)
    }
  }

  const handlePresetAction = (instruction: string) => {
    runAiEdit(instruction)
  }

  const handleCustomEdit = () => {
    // Position the input near the selection
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setAiInput({
        x: Math.min(rect.left, window.innerWidth - 320),
        y: Math.max(rect.top - 40, 8),
      })
    }
  }

  const applyChanges = (changesToApply: EditChange[]) => {
    let newContent = content
    const sorted = [...changesToApply].sort((a, b) => b.StartOffset - a.StartOffset)
    for (const c of sorted) {
      newContent = newContent.replace(c.Original, c.Proposed)
    }
    setContent(newContent)
    onContentUpdate(note.ID, newContent)
  }

  const handleAccept = (index: number) => {
    applyChanges([changes[index]])
    const remaining = changes.filter((_, i) => i !== index)
    setChanges(remaining)
  }

  const handleReject = (index: number) => {
    setChanges((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAcceptAll = () => {
    applyChanges(changes)
    setChanges([])
  }

  const handleCopy = () => {
    if (selectedText) navigator.clipboard.writeText(selectedText)
  }

  const hasSelection = selectedText.length > 0

  return (
    <div className="relative">
      {/* Diff review bar */}
      {changes.length > 0 && (
        <DiffBar
          changes={changes}
          onAccept={handleAccept}
          onReject={handleReject}
          onAcceptAll={handleAcceptAll}
          onDismiss={() => setChanges([])}
        />
      )}

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <Loader2 className="size-3 animate-spin" />
          <span>AI is thinking...</span>
        </div>
      )}

      {/* Context menu wrapping the note content */}
      <ContextMenu onOpenChange={(open) => { if (open) captureSelection() }}>
        <ContextMenuTrigger asChild>
          <div className="note-content prose prose-sm dark:prose-invert max-w-none select-text cursor-text
            prose-headings:font-semibold prose-headings:tracking-tight
            prose-h1:text-lg prose-h1:mb-3 prose-h1:mt-0 prose-h1:pb-1 prose-h1:border-b prose-h1:border-border/40
            prose-h2:text-base prose-h2:mb-2 prose-h2:mt-4
            prose-h3:text-sm prose-h3:mb-1 prose-h3:mt-3
            prose-p:text-sm prose-p:leading-relaxed prose-p:my-1.5
            prose-li:text-sm prose-li:my-0.5
            prose-strong:font-semibold
            prose-ul:my-1 prose-ol:my-1
            prose-hr:my-3 prose-hr:border-border/40
            [&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:accent-foreground
          ">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {hasSelection ? (
            <>
              <ContextMenuLabel className="text-[11px] text-muted-foreground font-normal truncate max-w-[220px]">
                &ldquo;{selectedText.slice(0, 40)}{selectedText.length > 40 ? "..." : ""}&rdquo;
              </ContextMenuLabel>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCustomEdit}>
                <MessageSquare className="size-3.5" />
                Edit with AI...
              </ContextMenuItem>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Wand2 className="size-3.5" />
                  Quick fixes
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-52">
                  <ContextMenuItem onClick={() => handlePresetAction("Fix any spelling or grammar errors in this text")}>
                    <SpellCheck className="size-3.5" />
                    Fix spelling &amp; grammar
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handlePresetAction("Fix any incorrect names — ensure consistent spelling throughout")}>
                    <Type className="size-3.5" />
                    Fix names
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handlePresetAction("Improve the clarity and readability of this text without changing the meaning")}>
                    <Sparkles className="size-3.5" />
                    Improve clarity
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handlePresetAction("Make this text more concise while keeping the key information")}>
                    <Wand2 className="size-3.5" />
                    Make concise
                  </ContextMenuItem>
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleCopy}>
                <Copy className="size-3.5" />
                Copy
              </ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => {
                setSelectedText(content)
                handlePresetAction("Fix any spelling, grammar, or name errors throughout this document")
              }}>
                <Wand2 className="size-3.5" />
                Fix entire note with AI
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => navigator.clipboard.writeText(content)}>
                <Copy className="size-3.5" />
                Copy all
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Floating AI input */}
      {aiInput && (
        <AiInputOverlay
          position={aiInput}
          loading={loading}
          onSubmit={runAiEdit}
          onClose={() => setAiInput(null)}
        />
      )}
    </div>
  )
}

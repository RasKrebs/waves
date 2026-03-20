# Waves — Feature Plan

Features discussed but not yet implemented, roughly ordered by dependency and impact.

---

## 1. Meeting Detection & Auto-Record Prompt

**Goal:** When the user joins a meeting (Teams, Zoom, Google Meet, etc.), Waves pops up from the menu bar asking "Looks like you're in a meeting — want to record?"

**Approach:**
- Poll `waves-audio list` on a short interval (every 5–10s) from the Electron main process
- Detect when a known meeting app starts producing audio (match bundle IDs: `us.zoom.xos`, `com.microsoft.teams2`, `com.tinyspeck.slackmacgap`, `com.google.Chrome.helper` with Meet tab, etc.)
- Show a native macOS notification or a small Electron popup anchored to the tray icon
- "Record" button starts recording with the detected app's PID as the audio source
- "Dismiss" suppresses for that session
- Config: `auto_detect.enabled`, `auto_detect.apps` (list of bundle IDs to watch), `auto_detect.prompt` (ask vs auto-start)

**Files:**
- `electron/main/meeting-detector.cts` — polling loop, detection logic, notification
- `electron/main/index.cts` — integrate detector lifecycle
- `electron/src/lib/process-names.ts` — already has the bundle ID map, reuse for detection
- `backend/waves/server.py` — no changes needed, recording starts via existing RPC

---

## 2. Unassigned Meeting Banner & Project Assignment Flow

**Goal:** After a meeting is recorded and notes are generated, the user opens Waves and sees that an unassigned meeting exists. They assign it to a project and pick the meeting type (which template to use for notes).

**Approach:**
- History/Meetings page shows a banner at top: "You have N unassigned meetings"
- Clicking expands an inline assignment UI: pick project (or create new), pick meeting type (general-meeting, standup, custom)
- On assignment + type selection, if notes don't match the selected template, offer to regenerate
- Sidebar project tree shows unassigned meetings under a virtual "Inbox" section

**Files:**
- `electron/src/routes/history.tsx` — unassigned banner, assignment inline UI
- `electron/components/app-sidebar.tsx` — "Inbox" section for unassigned meetings
- `backend/waves/server.py` — `ListSessions` already returns `ProjectID=""` for unassigned; may add a filter param

---

## 3. Meeting Type Selection & Template-Based Regeneration

**Goal:** User picks what kind of meeting it was (standup, general, 1:1, retrospective, etc.) and Waves regenerates notes using the right template.

**Approach:**
- Add `meeting_type` field to sessions table (nullable, stores template key)
- When user selects meeting type, delete existing auto-generated notes and regenerate with the selected template
- Show template picker as a dropdown/segmented control in the session detail header
- Templates are already in config — this just wires the UI to the existing `GenerateNotes` RPC with the template key as `NoteType`

**Files:**
- `backend/waves/store.py` — add `meeting_type` column to sessions (migration)
- `backend/waves/server.py` — `SetMeetingType` RPC, or extend `RenameSession` to accept meeting_type
- `electron/src/routes/history.tsx` — template picker in session detail header
- `electron/src/types/waves.d.ts` — add `MeetingType` to `SessionRow`/`SessionDetail`

---

## 4. Inline AI Editing (Context Menu)

**Goal:** User selects text in the meeting notes, right-clicks, and gets an "Edit with AI" option. They type a correction like "this name is wrong, it's AKA" and the AI fixes it in context — showing a diff the user approves.

**Approach:**
- Render notes as editable markdown (switch from `whitespace-pre-wrap` div to a contenteditable or lightweight editor like Tiptap/Milkdown)
- On text selection + context menu → show a small input popover: "What should change?"
- Send to backend: selected text, surrounding context, user instruction
- Backend calls LLM (Haiku — fast, cheap) with a focused prompt: fix this specific issue, check nearby content for the same error
- Return a diff: original → proposed. Show inline with green/red highlighting (like Cursor/Claude Code)
- User approves or rejects each change
- On approve, update the note content via `UpdateNote` RPC

**New RPC:** `Waves.EditNote` — accepts `NoteID`, `Selection`, `Context`, `Instruction` → returns `Changes: [{Original, Proposed, StartOffset, EndOffset}]`

**Files:**
- `backend/waves/pipeline/edit.py` — new module: AI edit with diff generation
- `backend/waves/server.py` — `EditNote` RPC handler
- `electron/src/components/note-editor.tsx` — new component: editable note with AI context menu
- `electron/src/routes/history.tsx` — replace static note display with NoteEditor
- `electron/src/types/waves.d.ts` — `EditChange` type, `editNote` method

---

## 5. Calendar/Mail Integration (Future)

**Goal:** Automatically infer which project a meeting belongs to, who the attendees are, and what type of meeting it is — using calendar invites and email context.

**Approach (phased):**
- **Phase A — Calendar read:** Read macOS Calendar events via EventKit (Swift helper or Electron native module). Match meeting time window to calendar events. Extract: title, attendees, recurrence pattern, description.
- **Phase B — Auto-classify:** Use the calendar event + first 30s of transcript to classify meeting type (standup if recurring daily with team, 1:1 if two people, etc.). LLM call with structured output.
- **Phase C — Project inference:** Match calendar event title/attendees to existing projects. Suggest project assignment. If no match, suggest creating a new project.
- **Phase D — Mail plugin (far future):** macOS Mail plugin or Outlook add-in that watches for meeting follow-ups. Could auto-send action items to attendees.

**Files:**
- `tools/waves-calendar/` — Swift CLI to read calendar events (similar to waves-audio)
- `backend/waves/calendar.py` — calendar event matching and classification
- `backend/waves/server.py` — `MatchCalendarEvent` RPC
- `electron/main/calendar.cts` — calendar integration bridge

---

## 6. Custom Templates Management UI

**Goal:** Let users create, edit, and delete note templates from within the app (not just YAML config).

**Approach:**
- Settings → Templates tab (or a dedicated section)
- List existing templates with preview
- "New Template" creates a template with a markdown editor
- Templates stored in config YAML (existing mechanism), or optionally in a `templates/` directory as individual `.md` files
- Template variables documented in-app: `{{.Title}}`, `{{.Date}}`, `{{.Duration}}`, HTML comments as fill instructions

**Files:**
- `electron/components/settings-dialog.tsx` — new "Templates" tab
- `electron/src/components/template-editor.tsx` — markdown editor with preview
- `backend/waves/server.py` — `CreateNoteTemplate`, `UpdateNoteTemplate`, `DeleteNoteTemplate` RPCs
- `backend/waves/config.py` — save/load templates to config

---

## 7. Model Management Improvements

**Goal:** Make enhancement and summarization models easily swappable per-template and per-project. Let projects override the default model.

**Approach:**
- Project-level config: each project can override `enhancement_model` and `summarization_model`
- Template-level hints: templates can suggest a model (e.g., standup uses Haiku for speed since it's short)
- Settings shows current model usage and cost estimate
- Model picker in session detail: "Regenerate with..." dropdown

---

## Priority Order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | Meeting detection & auto-record prompt | Medium | High — core UX differentiator |
| 2 | Unassigned meeting banner & assignment | Small | High — bridges recording to notes |
| 3 | Meeting type selection & template regen | Small | Medium — makes templates useful |
| 4 | Inline AI editing | Medium | High — key quality-of-life feature |
| 5 | Calendar integration | Large | High — automation endgame |
| 6 | Custom templates UI | Small | Medium — power user feature |
| 7 | Model management improvements | Small | Low — nice to have |

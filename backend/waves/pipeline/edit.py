"""Inline AI editing — applies targeted corrections to meeting notes.

Given a text selection, its surrounding context, and a user instruction,
uses a fast LLM to produce a list of changes (original → proposed).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)


@dataclass
class EditChange:
    original: str
    proposed: str
    start_offset: int
    end_offset: int


async def edit_note_selection(
    llm: Any,
    full_content: str,
    selection: str,
    instruction: str,
    context_before: str = "",
    context_after: str = "",
) -> list[EditChange]:
    """Use a fast LLM to apply a targeted edit to a note.

    Returns a list of changes so the user can approve/reject each one.
    The LLM also checks nearby content for the same error pattern.
    """
    prompt = (
        "You are a precise text editor. The user has selected part of their meeting notes "
        "and asked for a specific change.\n\n"
        "RULES:\n"
        "- Apply the user's instruction to the selected text\n"
        "- Also check the surrounding context for the SAME error pattern and fix those too\n"
        "- Return ONLY a JSON array of changes\n"
        "- Each change has: {\"original\": \"exact text to replace\", \"proposed\": \"replacement text\"}\n"
        "- Keep changes minimal — only change what the user asked for\n"
        "- Preserve formatting (markdown, line breaks, etc.)\n\n"
    )

    if context_before:
        prompt += f"CONTEXT BEFORE SELECTION:\n{context_before}\n\n"

    prompt += f"SELECTED TEXT:\n{selection}\n\n"

    if context_after:
        prompt += f"CONTEXT AFTER SELECTION:\n{context_after}\n\n"

    prompt += (
        f"USER INSTRUCTION: {instruction}\n\n"
        "Return a JSON array of changes. Example:\n"
        '[{"original": "misspeled name", "proposed": "correct name"}]\n\n'
        "JSON:"
    )

    log.info("AI edit: selection=%d chars, instruction=%s", len(selection), instruction[:80])
    result = await llm.complete(
        prompt,
        system="You are a precise text editor. Output only valid JSON.",
        max_tokens=2048,
        temperature=0.1,
    )

    # Parse the JSON response
    # Strip markdown code fence if present
    text = result.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:])
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

    try:
        changes_raw = json.loads(text)
    except json.JSONDecodeError:
        log.warning("AI edit returned invalid JSON: %s", text[:200])
        # Try to extract JSON array from the response
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            try:
                changes_raw = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return []
        else:
            return []

    if not isinstance(changes_raw, list):
        return []

    changes: list[EditChange] = []
    for c in changes_raw:
        if not isinstance(c, dict):
            continue
        original = c.get("original", "")
        proposed = c.get("proposed", "")
        if not original or original == proposed:
            continue

        # Find the offset of the original text in the full content
        offset = full_content.find(original)
        if offset < 0:
            # Try case-insensitive search
            lower_content = full_content.lower()
            offset = lower_content.find(original.lower())

        if offset >= 0:
            changes.append(EditChange(
                original=original,
                proposed=proposed,
                start_offset=offset,
                end_offset=offset + len(original),
            ))

    log.info("AI edit produced %d changes", len(changes))
    return changes

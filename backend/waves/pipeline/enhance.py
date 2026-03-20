"""Transcript enhancement — uses a fast LLM to fix transcription errors.

This is the first stage of the post-transcription pipeline:
1. enhance_transcript() — fix names, spelling, grammar, formatting
2. (then) generate_from_template() — map enhanced transcript to a note template
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


async def enhance_transcript(
    llm: Any,
    transcript: str,
    language_hint: str = "",
) -> str:
    """Use a fast LLM to clean up transcription errors.

    Fixes common ASR mistakes: misspelled names, homophones,
    missing punctuation, broken sentences, repeated words.
    """
    lang_note = f" The primary language is {language_hint}." if language_hint else ""

    prompt = (
        "You are a transcription editor. Your job is to clean up an automated "
        "speech-to-text transcript while preserving the original meaning exactly.\n\n"
        "Fix ONLY these issues:\n"
        "- Obvious misspellings and ASR errors (e.g., homophones, garbled words)\n"
        "- Missing or incorrect punctuation\n"
        "- Broken sentences that clearly should be joined\n"
        "- Repeated words/phrases from speech disfluency\n"
        "- Obvious name misspellings (be consistent — pick one spelling and use it throughout)\n\n"
        "Do NOT:\n"
        "- Summarize or shorten the transcript\n"
        "- Change the meaning or rephrase sentences\n"
        "- Add information that isn't in the original\n"
        "- Remove filler words unless they break readability\n\n"
        f"{lang_note}\n"
        "Return ONLY the cleaned transcript, nothing else.\n\n"
        f"TRANSCRIPT:\n{transcript}"
    )

    log.info("Enhancing transcript (%d chars)", len(transcript))
    result = await llm.complete(
        prompt,
        system="You are a precise transcription editor. Output only the corrected transcript.",
        max_tokens=8192,
        temperature=0.1,
    )
    log.info("Enhanced transcript: %d → %d chars", len(transcript), len(result))
    return result


async def generate_from_template(
    llm: Any,
    transcript: str,
    template: str,
    title: str = "",
    date: str = "",
    duration: str = "",
) -> str:
    """Map an enhanced transcript into a structured note template.

    The LLM fills in the template sections based on the transcript content.
    """
    # Pre-fill template metadata
    filled = template
    filled = filled.replace("{{.Title}}", title or "Meeting")
    filled = filled.replace("{{.Date}}", date or "")
    filled = filled.replace("{{.Duration}}", duration or "")

    prompt = (
        "You are a meeting notes assistant. Given a meeting transcript and a note template, "
        "fill in every section of the template with relevant content from the transcript.\n\n"
        "Rules:\n"
        "- Fill in ALL sections of the template — do not leave placeholder comments\n"
        "- Replace HTML comments (<!-- ... -->) with actual content from the transcript\n"
        "- If a section has no relevant content, write 'None discussed' or similar\n"
        "- For action items, use the checkbox format: - [ ] Task — Owner\n"
        "- For attendees/participants, infer from who is speaking in the transcript\n"
        "- Keep the markdown structure and headings from the template\n"
        "- Be concise but complete — capture what matters\n"
        "- Use bullet points for lists\n\n"
        f"TEMPLATE:\n```markdown\n{filled}\n```\n\n"
        f"TRANSCRIPT:\n{transcript}\n\n"
        "Fill in the template and return ONLY the completed markdown document."
    )

    log.info("Generating notes from template (%d char transcript)", len(transcript))
    result = await llm.complete(
        prompt,
        system="You are a meeting notes assistant. Output only the completed markdown document.",
        max_tokens=4096,
        temperature=0.2,
    )
    log.info("Generated notes: %d chars", len(result))
    return result

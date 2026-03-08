"""Summarization pipeline — runs multi-step workflows through an LLM provider.

A workflow has ordered steps, each with a prompt template. Templates use:
    {{.Transcript}}       — full transcript text
    {{.PreviousOutput}}   — output from the previous step
"""

from __future__ import annotations

import logging
from typing import Any

from waves.config import Workflow

log = logging.getLogger(__name__)


async def run_workflow(
    llm: Any,
    workflow: Workflow,
    transcript: str,
) -> str:
    """Execute a multi-step summarization workflow.

    Returns the final output from the last step.
    """
    if not workflow.steps:
        raise ValueError("workflow has no steps")

    previous_output = ""

    for i, step in enumerate(workflow.steps):
        prompt = step.prompt
        prompt = prompt.replace("{{.Transcript}}", transcript)
        prompt = prompt.replace("{{.PreviousOutput}}", previous_output)

        log.info("Running workflow step %d/%d: %s", i + 1, len(workflow.steps), step.name)
        previous_output = await llm.complete(prompt)
        log.info("Step %s produced %d chars", step.name, len(previous_output))

    return previous_output

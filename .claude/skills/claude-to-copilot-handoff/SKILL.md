---
name: claude-to-copilot-handoff
description: Use when Claude completes a phase and Copilot must continue with minimal context loss using deterministic handoff files.
---

# Claude to Copilot Handoff Skill

## Workflow

1. Summarize what changed and why.
2. Record validation evidence and unresolved risks.
3. Provide exact next 3 implementation actions.
4. Provide exact command sequence to resume.

## Required outputs

1. docs/context/copilot-continuation-handoff.md
2. docs/context/copilot-open-risks.md
3. docs/context/copilot-next-commands.md
4. Final log entry in logs/agent-work-log.md

## Quality bar

Handoff must be executable without prior chat history.

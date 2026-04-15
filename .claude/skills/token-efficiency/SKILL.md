---
name: token-efficiency
description: Use to reduce token usage during long-horizon rewrite sessions by using structured state files, concise deltas, and reusable command/checklist packs.
---

# Token Efficiency Skill

## Why

Long autonomous rebuild sessions can waste tokens by repeating context and instructions.

## Rules

1. Keep stable context in files, not chat repetition.
2. Use automation/vision-rebuild templates for logs, state, and checklists.
3. Read only files needed for current objective.
4. Summarize completed work in short deltas.
5. Store reusable lessons in memory, not full transcripts.

## Source guidance

Aligned to Anthropic prompting best practices:
1. Clear/direct instructions.
2. Structured prompts and templates.
3. Long-context workflow with state tracking.
4. Controlled effort settings and reduced over-exploration.

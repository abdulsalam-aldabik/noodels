---
name: vision-rebuild
description: Use when rebuilding the IQ Noodles vision feature from scratch with phased execution, validation gates, and evidence-driven debugging.
---

# Vision Rebuild Skill

## When to use

Use for full reset/rewrite work where existing feature code may be absent or untrusted.

## Workflow

1. Read docs/context/vision-rebuild-context-pack.md.
2. Read docs/prd/vision-rebuild-prd.md.
3. Run planning pass first (architecture + phase plan).
4. Implement one phase at a time.
5. Validate and log after each phase.

## Required artifacts

1. logs/agent-work-log.md entries for all major steps.
2. Updated automation/vision-rebuild/state-template.json.
3. Phase acceptance check against automation/vision-rebuild/phase-checklist.md.

## Success condition

Reliable end-to-end pipeline with reproducible debug evidence and clear handoff files.

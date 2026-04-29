# /vision-handoff

Use this command as the default entrypoint for a new implementation (full rebuild) or continuation of IQ Noodles board localization, rectification, and mapping.

## Start Here

1. Read docs/context/rewrite-kit/AGENT_HANDOFF_FULL_REWRITE_CLAUDE.md.
2. Run /vision-rebuild-kickoff.
3. Use /vision-plan-opus for planning.
4. Use /vision-implement-phase for implementation.
5. Use /vision-memory-sync at session boundaries.
6. Use /vision-handoff-to-copilot when Claude hands over to Copilot.

## Core Rules

1. No blind edits.
2. Evidence first, hypothesis second, patch third.
3. Append every major step to logs/agent-work-log.md.
4. Validate each phase before moving on.
5. Keep structured state in automation/vision-rebuild/state-template.json.

## Model Split Preference

1. Opus for planning and architecture decisions.
2. Other models for implementation-heavy work.
3. If model switching is unavailable, state it and continue with best available model.

## Reference Index

Use docs/context/rewrite-kit/CLAUDE_REWRITE_KIT_INDEX.md to locate all prompts, commands, agents, skills, templates, and handoff files.

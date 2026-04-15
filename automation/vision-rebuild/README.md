# Vision Rebuild Automation Pack

Purpose: reduce repetitive token-heavy chat instructions by keeping stable runbooks and command bundles in files.

## Use This Folder To Save Tokens

1. Keep reusable checklists and commands here.
2. Reference these files in chat instead of retyping long instructions.
3. Update only deltas between phases.

## Files

1. command-bundle.md - common run/build/debug commands
2. phase-checklist.md - per-phase acceptance checklist
3. state-template.json - compact machine-readable progress state
4. session-brief-template.md - concise context handoff template

## Usage Pattern

At session start:
1. Read docs/context/vision-rebuild-context-pack.md
2. Read docs/prd/vision-rebuild-prd.md
3. Read automation/vision-rebuild/phase-checklist.md
4. Initialize logs/agent-work-log.md with first entry

During work:
1. Update state-template.json at each phase boundary
2. Keep chat focused on current delta only

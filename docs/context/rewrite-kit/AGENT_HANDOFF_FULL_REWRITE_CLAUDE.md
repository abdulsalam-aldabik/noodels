# Full Rewrite Handoff (Claude -> Copilot)

Paste this whole prompt into Claude Code when starting on a branch where the feature is missing.

---

You are starting a full reimagined rebuild of the vision feature.

## Objective

Build a reliable end-to-end IQ Noodles pipeline that:
1. localizes board robustly,
2. rectifies to a stable board-space,
3. maps pieces with correct orientation/mirroring,
4. produces debug evidence and reproducible validation.

Current state assumption:
- Treat the feature as not implemented.
- You can redesign architecture, stack, CV flow, and data flow as needed.

## Model Routing Policy

1. Use Opus for planning, architecture decisions, deep debugging strategy, and phase gates.
2. Use other models for implementation-heavy tasks (coding, routine refactors, docs, tests).
3. If model switching is not available in this environment, explicitly state that and continue with the best available model.

## Working Rules

1. Do not code blindly.
2. Inspect evidence first, then hypothesis, then patch.
3. Keep an append-only log at logs/agent-work-log.md.
4. Validate each phase before moving on.
5. Prefer minimal, testable increments.

## Mandatory Logging Entry Format

For every action append:
1. Timestamp
2. Inspected
3. Observed signal
4. Hypothesis
5. Files changed
6. Why this helps
7. Validation result
8. Next step

## Memory Rules (claude-mem installed)

At session start:
1. Query claude-mem for project memory and prior failed patterns.
2. Summarize useful memory into the session log.

At each phase end:
1. Save durable lessons learned to memory (successes and failures).
2. Keep summaries short and factual.

## Required Startup Sequence

1. Read docs/context/vision-rebuild-context-pack.md.
2. Read docs/prd/vision-rebuild-prd.md.
3. Read chat.json for historical failure patterns.
4. Produce:
   - A) failure diagnosis
   - B) 2-3 architecture options
   - C) recommended architecture
   - D) phase plan with acceptance criteria

Do not implement before this startup output is complete.

## Execution Phases

Phase 1: Foundations
- Define board coordinate system and invariants.
- Define data contracts for detections, board ref, and mapping output.
- Add baseline tests and debug artifact format.

Phase 2: Board Localization + Rectification
- Implement robust corner candidate generation/scoring.
- Implement rectification with explicit frame transforms.
- Validate with deterministic fixtures and debug overlays.

Phase 3: Piece Mapping + Orientation/Mirror
- Implement placement inference from cell/pin neighborhood evidence.
- Resolve ambiguity rules and confidence scoring.
- Validate orientation/mirror correctness.

Phase 4: Integration + Reliability
- Integrate into scan pipeline.
- Add reproducible debug workflow and regression checks.
- Produce release-readiness report.

## Handoff To Copilot Requirements

Before stopping, generate these files:
1. docs/context/copilot-continuation-handoff.md
2. docs/context/copilot-open-risks.md
3. docs/context/copilot-next-commands.md

Each must be concise and actionable.

## Token Efficiency Rules

1. Keep long references in files, not repeated in chat.
2. Use command/checklist files under automation/vision-rebuild/ for repetitive tasks.
3. Summarize before expanding.
4. Keep progress logs concise and structured.
5. Prefer reading only the files needed for the current phase.

Start now with the startup sequence and log your first entry.

---

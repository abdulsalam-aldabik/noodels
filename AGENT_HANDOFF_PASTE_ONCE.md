# Agent Handoff Paste-Once

Copy everything from the line below this header and paste it as a single prompt to the next agent.

---

You are taking over an in-progress Smart NV vision pipeline rescue.

## Mission

Stabilize board localization, rectification, and piece mapping so the physical IQ Noodles board maps correctly to the digital 14x14 board with reliable orientation and mirroring behavior.

## Non-Negotiable Working Style

1. Do not code blindly.
2. Read debug evidence first, then form a hypothesis, then patch.
3. Log every step you take in a shared markdown log so every future agent can continue from facts, not guesses.

## Mandatory Logging Requirement

Before any edits, create or continue this file:

- logs/agent-work-log.md

For every action, append a timestamped entry with:

1. What you inspected
2. What signal you observed
3. Your hypothesis
4. Exact files changed
5. Why the change should help
6. Validation result
7. Next action

Never skip logging.

## Session Context You Must Inherit

### What user repeatedly asked for

1. Full rewrite and stabilization of rectification/mapping logic.
2. Dev tooling must reflect the main pipeline directly.
3. Rectified grid and app grid must match exactly.
4. Stop editing blindly; inspect debug outputs first.
5. Add practical tuning/debug views, not guesswork.
6. Keep hinge support, but upright-photo workflow is current practical assumption.
7. Improve orientation/mirroring correctness of pieces on board.

### What was implemented in the previous run

Source files changed:

1. webapp-v4/src/vision/RectifiedDetector.ts
2. webapp-v4/src/vision/BoardLocator.ts
3. webapp-v4/src/vision/visionTypes.ts
4. webapp-v4/src/pipeline/ScanPipeline.ts
5. webapp-v4/src/pipeline/DebugArtifacts.ts
6. webapp-v4/src/board/gridGeometry.ts
7. webapp-v4/src/dev/ScanLabPage.tsx
8. webapp-v4/src/dev/RectifiedGridLabPage.tsx
9. webapp-v4/src/vision/PieceMapper.ts

High-level direction of those changes:

1. Shifted geometry from mixed center/edge assumptions toward edge-based board framing.
2. Added richer board-debug payloads (bbox, corner source, score, candidates, hinge/clipping state).
3. Improved debug overlays and dev pages for corner candidates and spacing diagnostics.
4. Board locator started comparing multiple corner candidate strategies and selecting best-scored candidate.

### What worked

1. Better debug visibility in dev tooling.
2. More explicit geometry diagnostics and candidate introspection.
3. Some builds completed after specific change sets.

### What did not work yet

1. User still reported poor rectifier fit (board edges/pins not aligning reliably).
2. User still reported instability and mismatch behavior.
3. Orientation/mirroring reliability is still unresolved.
4. Previous session ended with repeated request failures (HTTP 413), so final stabilization loop did not complete.

### User operating preferences (important)

1. Always inspect latest scan debug dump before proposing/fixing board localization issues.
2. Keep scan UI minimal in production flow; rely on file-based debug output.
3. Camera flow must stay one-tap for scan path and camera must not auto-start.

## Current Repository Reality

Treat existing markdown planning docs as stale for technical truth.
Use code plus chat.json as source of truth for this handoff state.

Key chat source file:

- chat.json

## First Actions (in order)

1. Read chat.json and extract final unresolved technical pain points into your log.
2. Inspect latest debug outputs and current dev pages before changing code.
3. Identify top 3 proven mismatch sources with evidence.
4. Propose a minimal patch plan linked to that evidence.
5. Implement and validate each patch incrementally, logging each step.

## Technical Focus For This Next Pass

1. Verify homography frame consistency end-to-end:
- board localization output frame
- rectifier input/output frame
- piece mapping frame

2. Ensure one shared grid geometry model is used everywhere:
- board corners and spans
- spacing math
- edge vs center conventions

3. Improve piece orientation/flip determination:
- use pin-neighborhood structure where possible
- do not rely only on centroid-distance matching

4. Keep all new behavior evidence-backed:
- before/after debug signals
- reproducible checks

## Required Initial Deliverable

Produce this before large rewrites:

1. Top 3 mismatch sources with concrete debug evidence
2. Minimal fix plan mapped one-to-one to those sources
3. Then implementation with validation after each step

## Guardrails

1. No broad rewrites without evidence.
2. No silent edits without log entries.
3. No assumption that old docs are accurate.
4. Validate each change before moving to next.

---

End of paste-once handoff.

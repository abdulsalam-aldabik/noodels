# Copilot Continuation Handoff

## Current phase
Blender solved-placement stabilization for IQ Noodles dataset generation is in progress and
currently paused after adding stricter solved acceptance plus a standalone diagnostics runner.
Scope is `blender_yolo_generator_v2.py` solved-mode behavior, not webapp mapping.

## Architecture invariants
- Solver output remains the source of truth for solved piece identity + orientation metadata.
- `board_inner` must act as the effective solved grid surface when available.
- A solved sample is valid only when all of the following are true:
  - all 11 pieces are placed,
  - all pieces are inside frame margin,
  - projected overlap stays under hard threshold (`SOLVED_ACCEPT_MAX_OVERLAP_SUM`).
- Candidate ranking is not sufficient alone; hard acceptance gates must be enforced.

## What changed in this phase
- Solved placement metadata now includes solver anchor coordinates (`anchor_x`, `anchor_y`).
- Solved mapping supports `board_inner` grid bounds and solved grid auto-calibration
  (axis order, axis flips, inset candidates).
- Mirror handling was corrected by adding a +2 quarter-turn adjustment for mirrored pieces
  before render-space flip.
- Hard overlap rejection was added to both normal solved attempts and best-effort solved fallback.
- Added diagnostics script:
  - `automation/vision-rebuild/blender_solved_diagnostics.py`
  - Writes per-attempt PNGs, `report.json`, and `summary.md` into
    `debug-output/solved-diagnostics-<timestamp>/`.

## Why these changes were made
User-reported solved scenes showed off-grid scatter and intersections. The previous flow could
accept visually invalid solved layouts because framing-only acceptance allowed overlap-heavy
candidates to pass.

## Validation evidence
- `python -m py_compile automation/vision-rebuild/blender_solved_diagnostics.py` passes.
- No fresh runtime diagnostic batch has been executed yet in this session.
- User feedback after strict gates indicates some runs produce zero accepted solved boards.

## Known gaps
- No latest diagnostic artifact folder yet to confirm `board_inner` world-frame correctness.
- Solved acceptance may now be too strict under current random pose/HDRI conditions.
- Mirror correction is globally applied for mirrored pieces and still requires per-piece
  validation against rendered orientation ground truth.

## Next actions for Copilot
1. Run the diagnostics script against the active `.blend` scene and collect the output folder.
2. Use `report.json` attempt metrics to distinguish transform mismatch from threshold over-strictness.
3. If transform is correct but acceptance is starved, tune overlap threshold/calibration bounds while
   preserving collision-free solved outputs.

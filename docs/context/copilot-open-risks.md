# Copilot Open Risks

## Risk 1
- Description: Solved acceptance can collapse to zero after overlap hard-gating.
- Evidence: User reports "none of the solved board" after adding overlap rejection.
- Impact: Dataset generation may underproduce solved samples or silently bias toward random-only scenes.
- Mitigation: Run diagnostics and tune thresholds only after confirming transform correctness.

## Risk 2
- Description: `board_inner` may still not be the active solved grid frame in every pose.
- Evidence: User explicitly states inner board must act as grid; prior visuals still showed scattered placement.
- Impact: Even with good thresholds, solved outputs remain geometrically wrong/off-grid.
- Mitigation: Verify board vs board_inner world bounds and anchor mapping in diagnostic report per attempt.

## Risk 3
- Description: Mirror convention mismatch may still exist for some pieces.
- Evidence: A global +2 quarter-turn mirrored correction was added from diagnosis, but not yet validated piece-by-piece.
- Impact: Solved scenes can be non-overlapping yet orientation-invalid relative to solver truth.
- Mitigation: Compare rendered orientation against solver metadata using per-piece diagnostics before further tuning.

## Risk 4
- Description: Calibration ranking can favor lowest-overlap candidates that are still semantically wrong.
- Evidence: Current score uses overlap/spread projection; no explicit solver-cell semantic gate is enforced.
- Impact: Some accepted solved scenes may appear plausible but fail exact solved-state semantics.
- Mitigation: Add or inspect solver-cell consistency metrics in diagnostics and reject semantically invalid placements.

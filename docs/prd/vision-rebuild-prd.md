# PRD: Vision Feature Full Rebuild

## 1. Problem Statement

Current board localization, rectification, and piece mapping are not reliable enough for production use. Grid-fit inconsistency and orientation/mirroring ambiguity cause incorrect digital board states.

## 2. Goal

Deliver a robust, testable end-to-end pipeline that converts a user photo into a correct digital board state with high confidence and clear debug evidence.

## 3. Non-Goals

1. Preserve legacy implementation details.
2. Prioritize backward compatibility over correctness.
3. Build every optimization in v1.

## 4. Primary Users

1. Player scanning physical IQ Noodles board.
2. Developer debugging computer vision alignment.
3. Research/demo reviewer validating reliability.

## 5. Functional Requirements

### FR-1 Board Localization
1. Detect board reliably from image.
2. Produce board corner candidates with scores and selected winner.
3. Expose board bbox, corner source, and confidence.

### FR-2 Rectification
1. Rectify image into stable board-space frame.
2. Use explicit coordinate transforms with auditable matrices.
3. Preserve consistent 14x14 grid alignment.

### FR-3 Piece Mapping
1. Map piece detections into board cells.
2. Determine orientation and mirror state from shape/pin-neighborhood evidence.
3. Provide ambiguity flags with confidence score and fallback handling.

### FR-4 Debug and Observability
1. Persist debug artifacts per run (raw, corners, rectified, mapped, JSON report).
2. Include key metrics: corner score, spacing, pin detections, mapping confidence.
3. Ensure artifacts are sufficient for offline diagnosis.

### FR-5 Pipeline Integration
1. Integrate localization, rectification, and mapping into one reproducible flow.
2. Return structured result contract consumable by UI and solver.

## 6. Non-Functional Requirements

1. Deterministic behavior for same input and config.
2. Reproducible debug outputs.
3. Clear failure modes and actionable errors.
4. Reasonable runtime for interactive use.

## 7. Success Metrics

1. Board alignment: overlays align with board grooves/pins across validation set.
2. Mapping reliability: piece anchors and orientation/mirror correct for target scenarios.
3. Ambiguity rate reduced to acceptable threshold.
4. No silent failures; all uncertain states are surfaced.

## 8. Acceptance Criteria

1. End-to-end scans pass predefined validation checklist on test images.
2. Debug report includes all required telemetry fields.
3. Orientation/mirror tests pass for representative piece set.
4. Regression checks pass before handoff.

## 9. Delivery Plan

### Phase 1 - Architecture and Contracts
- Define coordinate frames, result schemas, and test scaffolding.

### Phase 2 - Board + Rectification
- Implement robust corner selection and rectified transform pipeline.

### Phase 3 - Mapping + Orientation
- Implement orientation/mirror inference and ambiguity logic.

### Phase 4 - Integration + Hardening
- Integrate full flow, run validation pack, document handoff.

## 10. Risks

1. Hinge class sparsity in dataset may reduce orientation anchor reliability.
2. Piece overlap/occlusion can degrade pin-based inference.
3. Overfitting to a small validation set.

## 11. Mitigations

1. Use multi-candidate scoring and confidence thresholds.
2. Preserve ambiguity states rather than forcing uncertain assignments.
3. Expand fixtures and edge-case tests incrementally.

## 12. Solved Synthetic Scene Quality Plan (Blender)

### 12.1 Prioritized Diagnosis Focus

1. Acceptance-gate gap (highest priority)
- Current solved success path accepts a scene when pieces are inside frame, even if overlap remains.
- Candidate scoring is currently advisory, not a hard pass/fail gate.

2. Calibration objective gap
- Auto-calibration minimizes projected 2D bbox overlap plus spread.
- This can still select visually plausible but physically intersecting or orientation-invalid layouts.

3. Orientation semantics gap
- Solver metadata uses rotation plus mirror state from grid placements.
- Placement transform needs explicit validation that rendered orientation matches expected solver orientation per piece.

4. Grid-frame mismatch risk
- Mapping from solver grid to board-space extents can be biased by board bbox choice and inset assumptions.
- This can produce almost-correct but still unsolved piece arrangement.

### 12.2 Instrumentation To Add (Concrete Logs/Metrics)

Add per-image solved diagnostics report files under a dedicated debug folder, with one JSON for summary plus optional JSONL per candidate.

Required metrics per solved attempt:

1. Scene metadata
- sample_index, split, mode (solved_full or solved_partial)
- board pose mode, solved attempt index, fallback stage

2. Calibration candidate metrics
- axis_u, axis_v, inset, flip_u, flip_v
- score, overlap_sum_2d, max_pair_overlap_2d, overlapping_pair_count_2d, spread_2d

3. Hard quality metrics after candidate application
- pieces_expected_count, pieces_placed_count
- inside_frame_all
- overlap_sum_2d and max_pair_overlap_2d (re-evaluated on accepted layout)
- mesh_collision_pair_count_3d (BVH overlap test)
- min_clearance_3d (or penetration depth proxy)

4. Orientation correctness metrics
- per piece: expected rotation_steps, expected mirrored, measured board-frame angle_deg, inferred mirrored
- per attempt: orientation_mismatch_count, max_abs_angle_error_deg

5. Solver-to-render grid consistency
- per piece: expected cell set size, observed projected cell coverage size, IoU_to_expected_cells
- per attempt: min_piece_iou, mean_piece_iou

### 12.3 Acceptance Gates For Solved Scenes

Gate A: Placement completeness
- pieces_placed_count equals expected visible piece count.

Gate B: Framing
- inside_frame_all is true with configured margin.

Gate C: Non-overlap (2D)
- overlap_sum_2d <= 0.002
- max_pair_overlap_2d <= 0.0005

Gate D: Non-intersection (3D)
- mesh_collision_pair_count_3d equals 0.

Gate E: Orientation correctness
- orientation_mismatch_count equals 0.
- max_abs_angle_error_deg <= 5.0.

Gate F: Solver consistency
- mean_piece_iou >= 0.95 and min_piece_iou >= 0.90.

Gate G: Batch stability
- solved_full success rate >= 98% on validation batch, with zero silent fallback promoted as success.

### 12.4 Practical Quick Fix (Fast Stabilization)

Add a hard overlap rejection gate in solved acceptance immediately:

1. After solved placement and before declaring attempt success, compute overlap_sum_2d and max_pair_overlap_2d for visible solved pieces.
2. If overlap exceeds threshold, reject the attempt and continue retry loop.
3. Only mark solved_ok true when frame gate and overlap gate both pass.

This is the fastest high-impact correction because it prevents intersecting solved outputs from being labeled successful, and forces auto-calibration and retries to converge on cleaner placements.

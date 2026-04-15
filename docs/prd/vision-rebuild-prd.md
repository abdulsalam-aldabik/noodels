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

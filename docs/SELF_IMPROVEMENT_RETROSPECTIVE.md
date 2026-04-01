# Self-Improvement Retrospective

## Smart NV - IQ Noodles Mapping and Solver Iterations

Date: 2026-04-01
Scope: Recent webapp-v3 mapping, solving, and visualization iterations
Goal: Capture exactly what was tried, what failed, what improved, and how to improve faster next time.

---

## 1) What We Tried

### A) Baseline setup and stability fixes
- Added missing stylesheet target so app could compile.
- Added ESLint setup to make lint checks runnable.
- Replaced invalid ONNX model artifact with a valid model copy.
- Revalidated with build and lint.

### B) Mapping strategy iterations
- Started from centroid and nearest-pin style mapping logic.
- Added global assignment over candidate placements.
- Added uncertain mapping handling and manual apply path.
- Added staged solve modes:
  - Auto
  - Safe
  - Force

### C) Rendering and UX iterations
- Removed connector mesh style that made board view visually noisy.
- Reduced heavy stroke styling and moved to clearer block/cell rendering.
- Added mapping diagnostics into solver panel.

### D) Template-first mapping pivot
- Shifted candidate generation toward template overlap scoring.
- Added occupancy-based metrics (IoU, precision, recall).
- Penalized invalid-cell coverage.

### E) Puzzle-aware improvements (latest pass)
- Added geometry-aware candidate features:
  - size fit
  - span fit
  - pin-count fit
- Added stronger candidate gating via minimum recall.
- Added solver-aware pruning in assignment search:
  - MRV-style piece selection
  - no-fit pruning
  - open-space pruning
- Added per-piece template quality diagnostics in UI.

---

## 2) What Failed (or Underperformed)

### A) Centroid/pin-first mapping quality
- Failure mode: looked plausible on some pieces but produced contradictory board states.
- Impact: solver often failed, timed out, or solved from fallback states.

### B) Early visual overlays
- Failure mode: line-heavy overlay was hard to read and did not help trust.
- Impact: user confidence dropped even when some predictions were correct.

### C) Corrupted/mismatched model artifact
- Failure mode: ONNX parse/protobuf errors at runtime.
- Impact: pipeline blocked before mapping logic could even run.

### D) Heuristic-only thresholds without piece-shape bias
- Failure mode: pieces with similar local overlap patterns were confused.
- Impact: wrong orientation/placement candidates occasionally scored too high.

### E) Diagnostics initially too shallow
- Failure mode: mapper showed only aggregate stats, not piece-level quality.
- Impact: difficult to debug why specific pieces failed.

---

## 3) What Became Better

### A) Reliability
- Global assignment reduced local greedy errors.
- MRV + pruning reduced infeasible branches earlier.
- Safe/force/auto modes gave controlled behavior under uncertainty.

### B) Mapping quality
- Template overlap scoring outperformed centroid-only behavior.
- Geometry-aware features improved discrimination between similar candidates.

### C) Debuggability
- Added branch-prune counters and per-piece quality summaries.
- Better visibility into why a mapping was selected or flagged uncertain.

### D) User comprehension
- Cleaner board rendering improved readability and trust.

---

## 4) Root Causes of Past Failures

1. Over-reliance on local geometric shortcuts instead of full-board consistency.
2. Weak observability during early iterations (not enough piece-level evidence).
3. Runtime asset integrity was not validated early enough.
4. Heuristics were introduced before building a repeatable evaluation harness.

---

## 5) Self-Improvement Actions (Concrete)

### Immediate (next 1-2 sessions)
1. Build a fixed replay set of difficult photos and expected outcomes.
2. Log per-piece top-3 candidates with reasons in a structured debug export.
3. Add a fail-fast model integrity check (size/hash) before runtime inference.
4. Tune thresholds on replay metrics instead of ad-hoc visual judgment.

### Short-term (next sprint)
1. Add confidence calibration for uncertain mapping decisions.
2. Add solver contradiction explanations (which placements conflict and why).
3. Add side-by-side visual mode:
   - detected occupancy
   - selected template occupancy
   - mismatch heatmap

### Process improvements
1. Introduce experiment IDs for each mapping change.
2. Require before/after metric snapshots per experiment.
3. Keep a single decision log linking:
   - change
   - expected effect
   - measured effect

---

## 6) Suggested Metrics for Future Iterations

- Piece placement accuracy
- Full-board exact match rate
- Solver success rate from mapped board
- Average uncertain count per image
- Assignment search time
- Pruned branch counts by reason

---

## 7) Current Status

- Build: passing
- Lint: passing
- Mapping strategy: template-first with geometry-aware scoring and solver-aware pruning
- Main remaining need: dataset-driven threshold tuning and repeatable evaluation pipeline

---

## 8) Related References

- Current progress log: docs/PROGRESS_LOG.md
- System architecture: docs/SYSTEM_ARCHITECTURE.md
- Project context: PROJECT_CONTEXT.md
- Assistant context guide: CLAUDE.md

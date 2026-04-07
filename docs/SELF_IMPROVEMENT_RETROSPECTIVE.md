# Self-Improvement Retrospective

## Smart NV - IQ Noodles Engine and 3D Board Integration Iterations

Date: 2026-04-07
Scope: Fresh IQ Noodles implementation in webapp-v3, Java parity engine port, interactive board flow, OBJ-based 3D rendering, merged 2D+3D board attempts, repeated orientation/scale correction passes, and final piece-level mirrored rotation stabilization.
Goal: Record exactly what was implemented, what failed repeatedly, what improved, and how to avoid the same loop next time.

---

## 1) What We Tried

### A) Fresh implementation reset (no reuse from prior app versions)
- Built a new engine module under `webapp-v3/src/iq-noodles-engine`.
- Ported Java source-of-truth board/piece/orientation/placement logic into TypeScript.
- Added parity-focused tests and test script support (Vitest).

### B) Java parity engine work
- Implemented board mask, pin map, and piece constants from `archive/java_reference`.
- Implemented orientation generation with rotation + reflection + dedup behavior.
- Implemented legal placement generation by orientation index and board scanning.
- Exposed engine exports and integrated with the new app shell.

### C) Interactive board behavior
- Added piece selection, rotate, snap, overlap rejection, pick-up, and clear board.
- Added placement preview on hover and visual occupancy circles on the 2D board.

### D) OBJ-based visual upgrade
- Added React Three Fiber + Drei + Three integration.
- Copied OBJ assets to `webapp-v3/public/models`.
- Added inventory 3D previews and board 3D scene rendering.

### E) Piece identity and class mapping corrections
- Replaced initial A->0 style mapping with required mapping:
  - 0=J, 1=C, 2=H, 3=B, 4=A, 5=K, 6=I, 7=G, 8=D, 9=F, 10=E.
- Centralized mapping in `pieceAssets.ts` and displayed mapping in UI.

### F) Performance reduction pass
- Removed costly lighting/shadow setup.
- Switched to basic materials for speed.
- Lowered DPR and used demand frameloop where possible.

### G) Repeated 3D orientation and sizing correction passes
- Tried camera-axis changes (orthographic top views).
- Tried model-axis corrections.
- Tried orientationIndex heuristic mapping (mod + mirror).
- Replaced heuristic with geometry-derived transform per orientation.
- Re-aligned transform indexing with placement orientation indices.
- Reworked board world scale + zoom + model target sizing multiple times.

### H) Board composition reversals and merge attempts
- Switched to single 3D board-only presentation, then reverted when 2D reference features were requested back.
- Restored 2D board with pins and dots as trusted placement cues.
- Implemented merged overlay board (2D base + transparent 3D overlay).
- Reduced 3D board and model scale after user feedback about oversized board/pieces.
- Reworked transform stack again to force top-down rotation behavior.

### I) Engine-driven orientation metadata and piece-specific transform tuning
- Extended engine orientation pipeline to carry explicit transform metadata (`rotationSteps`, `mirrored`) into placements.
- Replaced UI-side orientation heuristics with engine metadata consumption in app placement logic.
- Separated board-only visual tuning from inventory by introducing `boardPieceTuning.ts`.
- Added per-piece mirrored inversion control (`invertRotationWhenMirrored`).
- Added per-piece mirrored even-step swap control (`swapEvenStepsWhenMirrored`) to fix alternating mismatch on pieces 5 and 9.
- Validated changes with passing tests and production build after each iteration.

---

## 2) What Failed (or Underperformed)

### A) Board valid-cell assumption mismatch
- Failure mode: expected 81 valid cells but Java source mask produced 84.
- Impact: parity test failed and caused confusion.

### B) First 3D mapping looked correct in cards but wrong on board
- Failure mode: pieces appeared as thin strips or tiny objects in a large panel.
- Impact: user could not trust board orientation/placement rendering.

### C) Orientation transform drift
- Failure mode: orientation looked partly correct in some indices but wrong in others.
- Root cause: transform lookup and placement orientation index alignment were not stable in one pass.
- Impact: visual rotation parity was inconsistent and felt random.

### D) Zoom/scale oscillation
- Failure mode: making panel bigger did not always make board content bigger; camera zoom and world units fought each other.
- Impact: repeated iterations without immediate visual convergence.

### E) Too many quick visual tweaks before lockable debug instrumentation
- Failure mode: camera/model/material changes were made without a fixed per-piece transform debug readout.
- Impact: slower diagnosis loop for orientation parity.

### F) Build/test green but visual acceptance red
- Failure mode: compile and tests pass while visual quality is still unacceptable.
- Impact: false completion signal and repeated rework loops.

### G) Merged-board behavior instability (resolved)
- Failure mode: merged board concept worked structurally, but 3D rotation and size parity were not initially stable enough.
- Impact: user reported the result did not work despite technical pass criteria.
- Resolution: piece-level mirrored-step tuning plus transform cleanup produced stable final behavior across rotate cycles.

### H) Uniform transform assumptions across all pieces
- Failure mode: one global mirror/rotation composition strategy did not work for all pieces.
- Impact: pieces 5 and 9 showed alternating success/failure over rotate steps (0 and 180 looked correct while 90 and 270 appeared flipped).
- Root cause: piece-specific model transform behavior differed from majority assumptions.

---

## 3) What Became Better

### A) Engine correctness baseline
- New engine module compiles and tests pass consistently.
- Legal placement generation and orientation enumeration are deterministic.

### B) Functional UX baseline
- User can now select/rotate/snap/pick-up pieces with legality checks.
- Piece IDs, labels, colors, and OBJ assets are explicitly mapped and visible.

### C) Performance stability
- Build/test remain green while using lower-cost 3D rendering.
- No-shadow/basic-material path keeps interaction responsive.

### D) Orientation strategy maturity
- Shifted from index heuristic to geometry-derived transform matching.
- Established a stronger method for transform derivation against base orientation.

### E) Board reference quality improved
- 2D pins/dots were restored and are now available while calibrating 3D behavior.
- Merged-board direction is preserved, but still needs final transform stabilization.

### F) Rotation/mirror parity pipeline became explicit and debuggable
- Orientation behavior now flows from engine metadata instead of ad hoc UI derivation.
- Board-only tuning no longer mutates inventory visuals.
- Piece-specific mirrored-step controls resolved the observed alternating mismatch pattern for problematic pieces and passed final manual validation.

---

## 4) Root Causes of Past Failures

1. Mixed coordinate frames (OBJ authoring axis vs board render axis) were not normalized once and frozen.
2. Transform derivation and placement index mapping were changed in tandem, making regressions hard to isolate.
3. Camera zoom and world-unit scale were tuned ad hoc without a single calibration model.
4. We did not add a per-piece orientation debug overlay early, delaying precise parity checks.
5. We repeatedly changed multiple visual variables per patch, obscuring causal impact.
6. We used compile/test pass as a proxy for visual correctness, which is insufficient for this problem.

---

## 5) Self-Improvement Actions (Concrete)

### Immediate (next 1-2 sessions)
1. Add a temporary debug overlay in 3D board showing: pieceId, orientationIndex, derived rotationSteps, mirrored.
2. Keep one calibration table per piece (base yaw, base mirror, composition order, rotation direction) and freeze constants after visual pass.
3. Add screenshot-based visual regression checks for 5 fixed merged-board placements.
4. Keep one stable camera/world-scale preset and tune only piece transform constants.
5. Keep explicit acceptance gate: no side-view artifacts and no alternating rotate mismatch in canonical orientation checks.

### Short-term (next sprint)
1. Integrate exact anchor-cell alignment for 3D models so OBJ center is not used as placement anchor.
2. Add drag UX improvements (ghost transform preview with orientation info).
3. Add solver/hint module on top of stabilized board state representation.

### Process improvements
1. Every render experiment must include: before screenshot, after screenshot, and exact constants changed.
2. Lock one variable at a time (camera or model scale or axis correction), not multiple at once.
3. Keep a compact changelog in the weekly template with outcome verdict per experiment.
4. Track two statuses per iteration: technical status (build/test) and visual status (user acceptance).

---

## 6) Suggested Metrics for Future Iterations

- 3D orientation parity rate (manual set): percentage of placements visually matching expected rotation/mirror.
- 3D board occupancy coverage: fraction of board viewport effectively occupied by piece geometry.
- Frame render responsiveness (subjective + measured FPS sample in dev tools).
- Piece placement accuracy.
- Full-board exact match rate.
- Solver success rate from mapped board.

---

## 7) Current Status

- Build: passing.
- Tests: passing.
- New IQ Noodles engine and interactive board are implemented.
- Piece class/index/color/OBJ mapping is now explicit and correct per requested order.
- 2D board pins/dots are restored and merged-board direction is implemented.
- Engine-driven orientation metadata (`rotationSteps`, `mirrored`) is wired through placements and consumed by UI.
- Board-only piece tuning includes base rotation/mirror with mirrored inversion and mirrored even-step swap controls.
- Latest targeted fixes resolved alternating mirrored rotate mismatch for pieces 5 and 9 using piece-specific tuning flags.
- Build status: passing. Test status: passing (15/15).
- Remaining work: add lightweight visual regression artifacts/screenshots to guard against future regressions.

---

## 8) Related References

- Engine module: `webapp-v3/src/iq-noodles-engine/`
- Interactive app: `webapp-v3/src/iq-noodles-app/`
- Weekly log template: `docs/SELF_IMPROVEMENT_WEEKLY_TEMPLATE.md`
- Assistant context guide: `CLAUDE.md`

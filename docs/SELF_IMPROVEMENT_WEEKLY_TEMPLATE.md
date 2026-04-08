# Self-Improvement Weekly Template

Project: Smart NV - IQ Noodles
Week of: 2026-03-30 to 2026-04-05
Owner: Abdul + Copilot Pairing Session

---

## 1) Weekly Objective

Primary goal:
- Build a fresh IQ Noodles app baseline with Java-parity engine logic and real OBJ-based 3D piece rendering in inventory and board views.
- Merge 2D and 3D board presentation so pin/dot 2D features remain visible while 3D pieces stay correctly sized and correctly rotated.

Success criteria:
- Engine parity tests pass and project build remains green after each major iteration.
- Piece class mapping and IDs are explicit and match required order: 0=J, 1=C, 2=H, 3=B, 4=A, 5=K, 6=I, 7=G, 8=D, 9=F, 10=E.
- Single merged board is visually usable (no giant 3D board, no giant pieces, no side-view rotation artifacts).
- No alternating rotation mismatch on problematic pieces across full rotate cycle.

---

## 2) Experiments Run

| ID | Change Implemented | Hypothesis | Files/Modules | Status |
|----|---------------------|-----------|---------------|--------|
| EXP-01 | Created fresh engine module (board, pieces, orientations, placements) from Java references | Strict parity base will reduce downstream ambiguity | `webapp-v3/src/iq-noodles-engine/*` | Done |
| EXP-02 | Added parity tests + vitest script | Fast regression checks will prevent logic drift | `webapp-v3/src/iq-noodles-engine/__tests__/engine.test.ts`, `webapp-v3/package.json` | Done |
| EXP-03 | Added interactive select/rotate/snap/pick-up flow | Playable board loop will expose mapping/render problems early | `webapp-v3/src/iq-noodles-app/IQNoodlesApp.tsx` | Done |
| EXP-04 | Integrated OBJ rendering via React Three Fiber | Real-piece look in UI will improve trust and matching | `PieceModel3D.tsx`, `PiecePreview3D.tsx`, `BoardScene3D.tsx`, `public/models/*` | Done |
| EXP-05 | Corrected piece ID mapping to required order | Consistent class identity across YOLO/app/board | `webapp-v3/src/iq-noodles-app/pieceAssets.ts` | Done |
| EXP-06 | Performance simplification (no shadows/basic materials/lower dpr) | Faster interaction with acceptable visual quality | `PieceModel3D.tsx`, `BoardScene3D.tsx`, `PiecePreview3D.tsx` | Done |
| EXP-07 | Orientation transform derivation from geometry instead of heuristic index rules | Rotation/mirror parity should become stable | `webapp-v3/src/iq-noodles-app/IQNoodlesApp.tsx` | Done |
| EXP-08 | Repeated board zoom/scale/layout calibration | Board should appear large and readable without over-zoom | `BoardScene3D.tsx`, `iq-noodles-app.css` | Done |
| EXP-09 | Switched to single 3D board only (removed 2D board) | Simpler visual surface may reduce mismatch confusion | `IQNoodlesApp.tsx`, `BoardScene3D.tsx`, `iq-noodles-app.css` | Reverted |
| EXP-10 | Restored 2D board with pins/dots alongside 3D board | Bring back reliable board reference features while keeping 3D visuals | `IQNoodlesApp.tsx`, `iq-noodles-app.css` | Done |
| EXP-11 | Attempted merged overlay board (2D base + 3D overlay) with reduced 3D scale | Keep 2D features and improve readability in one board surface | `IQNoodlesApp.tsx`, `BoardScene3D.tsx`, `iq-noodles-app.css` | Partial |
| EXP-12 | Reworked 3D piece transform stack to force top-down rotation plane | Eliminate side-view and strip-like rotation artifacts | `PieceModel3D.tsx`, `BoardScene3D.tsx` | Partial |
| EXP-13 | Added engine-driven orientation metadata pipeline (`rotationSteps`, `mirrored`) through placements | Remove UI heuristic drift and make orientation source-of-truth explicit | `orientation.ts`, `placements.ts`, `types.ts`, `IQNoodlesApp.tsx` | Done |
| EXP-14 | Split board-only tuning from inventory transforms | Prevent board tuning from mutating inventory visuals | `boardPieceTuning.ts`, `pieceAssets.ts`, `PieceModel3D.tsx`, `BoardScene3D.tsx` | Done |
| EXP-15 | Added per-piece transform composition and rotation-direction tuning | Resolve piece-specific alternating mismatch (pieces 5 and 9) | `boardPieceTuning.ts`, `PieceModel3D.tsx`, `BoardScene3D.tsx` | Done |

---

## 3) What Failed (Exact)

### Failure A
- What was tried: Initial assumption that board valid cells should be 81.
- What happened: Parity test failed.
- Failure signal: Test expected 81, actual computed value was 84 from Java mask.
- Suspected root cause: Historical documentation drift vs source code truth.
- Evidence (logs/screenshots/metrics): Vitest failure resolved after aligning test to Java-derived mask value.

### Failure B
- What was tried: Multiple camera/model-axis/zoom tweaks for 3D board orientation and size.
- What happened: Pieces sometimes appeared as strips, tiny content in large panel, or weird rotations.
- Failure signal: User screenshots repeatedly showed wrong visual orientation and undersized board content.
- Suspected root cause: Mixed axis conventions + unstable transform mapping between orientation index and render transform.
- Evidence (logs/screenshots/metrics): Iterative fixes required across `PieceModel3D.tsx` and `BoardScene3D.tsx` with repeated visual feedback.

### Failure C
- What was tried: Overlay-merge of 2D and 3D into one board surface.
- What happened: Visual composition improved in concept, but piece scaling/rotation consistency still broke usability.
- Failure signal: User feedback that merged version still "does not work" with oversized/incorrect 3D behavior.
- Suspected root cause: Overlay scale constants and transform math were changed together, making regressions hard to isolate.
- Evidence (logs/screenshots/metrics): Build/test passed while manual visual acceptance failed.

### Failure D
- What was tried: Rotation corrections via axis sign flips and nested transform stack changes.
- What happened: Some orientations still looked wrong (side-ish view or incorrect facing) despite passing compile/build.
- Failure signal: User reported 3D rotation quality as unacceptable.
- Suspected root cause: Base OBJ axis normalization + rotation convention + mirror order are still not fully aligned per piece.
- Evidence (logs/screenshots/metrics): Repeated edits in `PieceModel3D.tsx` and `BoardScene3D.tsx`; no runtime errors but unresolved visual parity.

### Failure E
- What was tried: Global transform settings applied uniformly for all pieces.
- What happened: Pieces 5 and 9 alternated between fitting and flipped output on consecutive rotate steps.
- Failure signal: Pattern observed as 1st fits, 2nd wrong, 3rd fits, 4th wrong.
- Suspected root cause: Those pieces required piece-specific composition and step-direction handling.
- Evidence (logs/screenshots/metrics): Runtime reproduction plus final stabilization after per-piece `mirrorAfterRotation` and `rotationDirection` settings.

---

## 4) What Worked Better

### Improvement A
- Change: Introduced geometry-derived orientation transform matching instead of simple orientationIndex heuristics.
- Why it helped: Better captures real rotation/mirror relation between base orientation and placed orientation.
- Before: Rotation parity was inconsistent across pieces/orientations.
- After: Rotation behavior improved and no longer relies only on `index % 4` + `index >= 4` guesswork.
- Confidence level (Low/Med/High): Med

### Improvement B
- Change: Simplified 3D rendering pipeline (basic materials, no shadows, lower dpr, demand frameloop).
- Why it helped: Reduced GPU cost and improved responsiveness while keeping piece identity visible.
- Before: Heavy rendering with slower feedback loops.
- After: Faster interaction and easier iteration during debugging.
- Confidence level (Low/Med/High): High

### Improvement C
- Change: Restored 2D board pins/dots while keeping 3D pieces in flow.
- Why it helped: The 2D board remains a reliable positional reference during debugging.
- Before: Pure 3D view removed trusted board cues.
- After: Spatial reference improved, even though final 3D rotation parity is still unresolved.
- Confidence level (Low/Med/High): Med

### Improvement D
- Change: Orientation metadata now comes from engine placements instead of UI-side inference.
- Why it helped: Eliminated orientation-index heuristic drift and improved repeatability.
- Before: UI guessed orientation behavior from index grouping.
- After: UI consumes explicit `rotationSteps`/`mirrored` from engine pipeline.
- Confidence level (Low/Med/High): High

### Improvement E
- Change: Added piece-specific rotation direction and transform composition controls.
- Why it helped: Fixed alternating mismatch behavior on hard pieces without breaking inventory rendering.
- Before: 90/270 step parity was unstable for pieces 5 and 9.
- After: Full rotate cycle behavior aligned for those pieces in current manual validation.
- Confidence level (Low/Med/High): Med

---

## 5) Metrics Snapshot

| Metric | Baseline | Current | Delta | Target | Pass/Fail |
|--------|----------|---------|-------|--------|-----------|
| Piece placement accuracy | N/A | N/A | N/A | >= 0.90 (eval set) | Pending |
| Full-board exact match rate | N/A | N/A | N/A | >= 0.70 | Pending |
| Solver success from mapped board | N/A | N/A | N/A | >= 0.90 | Pending |
| Avg uncertain mappings/image | N/A | N/A | N/A | <= 1.5 | Pending |
| Mapping runtime (ms) | N/A | N/A | N/A | <= 150 ms | Pending |

---

## 6) Debug Evidence Index

- Run IDs:
  - webapp-v3 `npm run test` (multiple runs, all passing after fixes)
  - webapp-v3 `npm run build` (multiple runs, passing after each iteration)
  - webapp-v3 merged-board pass: `npm run build` passing with overlay implementation
- Key screenshots:
  - User screenshots showing tiny 3D board content and strip-like piece render after axis changes.
  - User screenshots showing rotation still off despite prior patches.
  - User feedback after merged overlay: still unacceptable rotation and scale behavior.
- Key logs:
  - Vitest output: 6 tests passing in `src/iq-noodles-engine/__tests__/engine.test.ts`.
  - Build output: successful Vite production builds after render updates.
  - Latest vitest output: 3 test files passed, 15 tests passed.

---

## 7) Decisions Made This Week

1. Build a fresh implementation path rather than adapting prior app versions.
  Reason: Existing versions were explicitly rejected and created noise.
  Impact: New engine/app modules under `webapp-v3/src/iq-noodles-engine` and `webapp-v3/src/iq-noodles-app`.
2. Treat Java code as source-of-truth over narrative docs when they conflict.
  Reason: Valid-cell mismatch showed source code reality differed from assumptions.
  Impact: Tests aligned to Java mask output.
3. Use explicit piece asset mapping file for IDs, labels, colors, OBJ references.
  Reason: Prevent silent mapping drift across UI and model outputs.
  Impact: Mapping is centralized and visible in UI.
4. Prefer geometry-derived transform mapping for orientation rendering.
  Reason: Heuristic index mapping produced wrong rotations.
  Impact: Better, though still not fully stabilized in all user-reported views.
5. Keep 2D board features visible while calibrating 3D.
  Reason: 2D pins/dots are a stable visual reference for placement and orientation debugging.
  Impact: Merged-board direction kept, but requires instrumentation-driven 3D calibration to finish.
6. Introduce piece-specific transform controls only after engine metadata is authoritative.
  Reason: Engine-first orientation data avoids masking logic problems with visual-only hacks.
  Impact: Piece 5/9 mismatch addressed with controlled per-piece tuning.

---

## 8) Next Week Plan (Actionable)

1. Add per-piece 3D debug overlay: pieceId/orientationIndex/derivedRotation/mirror near each placed model.
2. Add piece-specific anchor and base-rotation calibration table and lock constants only after 5 canonical placement checks per piece.
3. Build a tiny visual regression suite (saved screenshots) for fixed merged-board states to prevent orientation regressions.
4. Freeze board scene constants first (unit/zoom/targetSize), then tune only per-piece transform constants.

Risks:
- Overfitting render constants to one screen size/device.
- Continuing to mix camera-scale and model-scale tuning in the same change.
- False confidence from build/test green while visual parity is still wrong.

Mitigation:
- Keep camera preset fixed while tuning only per-piece transforms.
- Verify on desktop + mobile viewport snapshots before finalizing constants.
- Add explicit acceptance gate: no side-view artifacts in any of the 5 canonical orientation cases.

---

## 9) Self-Improvement Review

What I should keep doing:
- Converting user feedback into immediate concrete edits instead of long discussion.
- Running build/tests after each meaningful code change.

What I should stop doing:
- Applying multiple visual variables in one patch when debugging orientation.
- Claiming a visual issue is solved before adding deterministic parity instrumentation.

What I should start doing:
- Adding explicit debug visualization before iterative rendering tweaks.
- Logging each render experiment with constants and outcome verdict.
- Recording "visual pass/fail" separately from build/test pass for each experiment.
- Keeping per-piece tuning changes isolated and documented to prevent regressions in already-correct pieces.

---

## 10) Fill Checklist

- [x] Every experiment has hypothesis and status
- [x] Every failure has evidence
- [x] Every improvement has before/after
- [x] Metrics table fully updated
- [x] Next week actions are concrete

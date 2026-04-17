# Agent Work Log

Use this file as the continuous cross-agent execution log.

Entry template:

## YYYY-MM-DD HH:MM:SS
1. Inspected
2. Observed signal
3. Hypothesis
4. Files changed
5. Why this helps
6. Validation result
7. Next step

---

## 2026-04-14 session-start
### Agent handoff startup — chat.json + all 9 key files + latest debug JSON

1. **Inspected**
   - `chat.json` (previous Copilot session context)
   - All 9 handoff files: `BoardLocator.ts`, `RectifiedDetector.ts`, `PieceMapper.ts`,
     `gridGeometry.ts`, `ScanPipeline.ts`, `DebugArtifacts.ts`, `ScanLabPage.tsx`,
     `RectifiedGridLabPage.tsx`, `visionTypes.ts`
   - Most recent debug JSONs: `scan-2026-04-13T18-54-17.json`, `scan-2026-04-13T19-30-49.json`
   - `git diff HEAD` for all modified files

2. **Observed signal**
   - Debug JSONs are from the **OLD code** (before previous agent's changes).
     `boardCornerSource = "mask_diagonal_extremes_inset_strong"` — that string does NOT
     exist in the current working-directory `BoardLocator.ts`. New code uses
     `"mask_diagonal_extremes"` / `"mask_bbox_fused"` / `"bbox"`.
   - `boardCornerCandidates` and `boardCornerScore` fields are missing from all existing JSONs
     — those fields were added by the previous agent and no new scans have been run since.
   - `cellSpacingPx: 34.89` (and 36.52 in earlier run) vs expected 40.0 — old formula
     used `maxCenterSpan=13` giving `640/15=42.667`, which was then further distorted by
     a "shrink=1.35" auto-calibration the old code had.
   - Old auto-calibration warning: `"inset=0.055,0.024,0.028"` — auto-calibration found
     `topRatio≈0.055` as the optimal trim for the physical board/hinge.
   - Current `DEFAULT_LOCATE_CONFIG.topRatio = 0.1` (also in `DEFAULT_SCAN_CONFIG` and
     ScanLabPage initial state) — **80% larger than the evidence-based optimum of 0.055**.
   - All 4 piece mappings in the last run show `ambiguous: true`.

3. **Hypothesis**

   ### Mismatch Source #1 (highest priority): `topRatio` default too large
   `topRatio = 0.1` over-insets the top edge by `(0.1 - 0.055) × boardHeight`.
   For `boardHeight ≈ 2175px` that is ~98px extra trim ≈ 2.4 cells deep into the
   playable area. The TL/TR corners used for the homography are pushed into the grid,
   making the entire mapped area shift upward by ~2 rows. This is the primary cause of
   the grid overlay not aligning with physical pins.

   ### Mismatch Source #2: Previous agent's coordinate-system fix is correct but untested
   The previous agent fixed two related bugs:
   - `expectedRectifiedCellSpacing`: denominator changed from `maxCenterSpan (13)` to
     `maxEdgeSpan (14)` → cellSpacing 42.667 → 40. (Was the root cause of 34.89 spacing)
   - Both `locateBoard` BOARD_DST_CORNERS and `buildRectifiedGeometry` boardGridCorners
     changed from center corners `[0..13]` to edge corners `[-0.5..13.5]`.
   These are correct geometric fixes. But ZERO new scans have been run since. No debug
   artifact confirms the new code runs without regression.

   ### Mismatch Source #3: hinge detection inactive → top edge relies solely on mask
   `hingeSnapped: false` in all recent scans. No hinge class was detected. The TL/TR
   corners come entirely from `cornersFromHullDiagonalExtremes` on the board mask polygon.
   The board mask includes the full hinge bar at top, so TL/TR are at the TOPMOST points
   of the hinge. The `topRatio` inset must clear the entire hinge height plus top frame.
   With wrong topRatio this is not cleared, and the homography anchor is physically inside
   the board.

4. **Files changed** — NONE YET (diagnostic phase)

5. **Why this helps** — n/a (diagnostic)

6. **Validation result** — n/a (diagnostic)

7. **Next step** — Patch 1: change `topRatio` default from `0.1` to `0.062` in all three
   locations: `DEFAULT_LOCATE_CONFIG` (BoardLocator.ts), `DEFAULT_SCAN_CONFIG`
   (visionTypes.ts), and ScanLabPage initial state. This brings the default close to the
   evidence-backed optimum of 0.055 with a small safety margin.

---

## 2026-04-14 patch-1 — Fix topRatio default: 0.1 → 0.062

1. **Inspected** — `DEFAULT_LOCATE_CONFIG` (BoardLocator.ts:29), `DEFAULT_SCAN_CONFIG`
   (visionTypes.ts:32), `ScanLabPage useState(0.10)` (ScanLabPage.tsx:147)

2. **Observed signal** — All three locations use `topRatio: 0.10 / 0.10`. Old
   auto-calibration evidence from `scan-2026-04-13T19-30-49.json` warning shows
   `inset=0.055,0.024,0.028` as the auto-found optimal values for the actual board.

3. **Hypothesis** — Changing topRatio to 0.062 will move TL/TR corners ~83px closer to
   the actual playable-area edge (vs current 217px trim vs optimal 120px trim for this
   board). This should reduce the systematic top-offset of the grid overlay by ~2 rows.

4. **Files changed**
   - `webapp-v4/src/vision/BoardLocator.ts` — `topRatio: 0.1` → `topRatio: 0.062`
   - `webapp-v4/src/vision/visionTypes.ts` — `topRatio: 0.1` → `topRatio: 0.062`
   - `webapp-v4/src/dev/ScanLabPage.tsx` — `useState(0.10)` → `useState(0.062)`

5. **Why this helps** — topRatio determines how far TL/TR corners are pushed down from
   the detected board mask top. With old evidence showing 0.055 optimal and current
   0.1 being 2× too large, reducing to 0.062 eliminates ~55% of the top-edge error.
   The ScanLabPage sweep (0.04..0.19) lets the user fine-tune further.

6. **Validation result** — BUILD PASSES (`npm run build` in webapp-v4: 611 modules
   transformed, tsc -b clean, no type errors).

7. **Next step** — User must run `/dev/scan-lab` with the dev server (`npm run dev`
   in webapp-v4), load `webapp-v4/test-images/20260414_144554.jpg`, click
   "Run Selected", check the **Mapped** tab. Key things to observe:
   - `cellSpacingPx` in the Geometry panel should now be exactly **40.0** (fixed by
     previous agent's edgeSpan formula).
   - `boardCornerSource` and `boardCornerCandidates` should now be populated in the
     JSON (first scan with new code).
   - The white grid lines in the Mapped view should align with the physical board
     cell grooves and white pin dots should sit on physical intersection pins.
   - If pins are still misaligned, use "Sweep Top Inset" button to find the optimal
     topRatio, then report the best topRatio value for the next agent to update the
     default.

   **Remaining risks:**
   - topRatio 0.062 is derived from old-code auto-calibration evidence; the new
     coordinate system fix may shift the effective optimum slightly. Sweep is needed.
   - Side inset (0.03) and bottom inset (0.03) have not been re-validated with the
     new edge-corner coordinate system. Old evidence: sideRatio=0.024, bottomRatio=0.028.
   - Orientation/mirroring for piece mapping still unresolved — this is the NEXT issue
     after the grid overlay is confirmed to fit correctly.

---

## 2026-04-14 patch-2 — Fix corner scorer bias + ambiguity threshold

1. **Inspected**
   - `scan-2026-04-14T14-48-03-655Z.json`: boardCornerSource="bbox" despite board being
     visibly tilted in corners.jpg. bbox score=0.9999958, mask_diagonal_extremes=0.9592.
   - `BoardLocator.ts:342-346`: score = boardCornerQualityScore + small bonuses.
     boardCornerQualityScore penalizes non-90° angles → rewards axis-aligned bbox.
   - `PieceMapper.ts:110-112`: ambiguity condition includes `dist - nearest.dist <= 0.9`
     → every centroid in every scan shows `ambiguous: true`.

2. **Observed signal**
   - Both debug JSONs: 100% of pieces are `ambiguous: true`.
   - corners.jpg: board tilted ~10°; bbox label "1.00", mask label "0.96".
   - boardCentroid [col=7.27, row=4.65] snaps to candidateCell [row=5, col=8] — 0.35 col error.

3. **Hypothesis**
   - Bug 1: quality scorer penalizes perspective tilt → bbox always wins →
     homography computed from wrong corners → systematic centroid offset.
   - Bug 2: `dist - nearest.dist <= 0.9` adds alternatives for almost all centroids
     even when piece is clearly in one cell → universal ambiguity.

4. **Files changed**
   - `webapp-v4/src/vision/BoardLocator.ts` — replace score formula with source-priority
     scoring: mask_diagonal_extremes=15, mask_bbox_fused=10, bbox=5. Keep
     boardCornerQualityScore for debug output only. Add `qualityScore` to
     EvaluatedCandidate and boardCornerCandidates debug output.
   - `webapp-v4/src/vision/visionTypes.ts` — add `qualityScore?: number` to
     BoardCornerCandidateDebug interface.
   - `webapp-v4/src/vision/PieceMapper.ts` — remove `|| dist - nearest.dist <= 0.9`
     from snapToCell alternatives condition.

5. **Why this helps**
   - mask_diagonal_extremes captures actual perspective quad → correct homography →
     centroids map to correct cells.
   - Removing the 0.9 threshold means `ambiguous: true` only when genuinely equidistant
     (second cell within 8% of nearest). This unblocks the assignment step.

6. **Validation result** — BUILD PASSES (`npm run build`: 611 modules, tsc -b clean)

7. **Next step** — Run scan-lab, verify boardCornerSource="mask_diagonal_extremes",
   verify pieces with ambiguous: false, check Mapped tab alignment.

---

## 2026-04-14 patch-3 — Pin-based homography refinement

1. **Inspected** — HomographyComputer.ts (4-point only DLT), ScanPipeline.ts runRectifiedStage,
   constants.ts POSITIONS_AROUND_PINS (21 pins with cell positions).

2. **Observed signal** — User: "images look warped, some edges bigger, some correct."
   "pins appear in same place across photos" → rectification center is correct but
   corner lever-arm errors distort edges. rectifiedToBoardMatrix was a pure scale matrix
   from buildRectifiedGeometry — no correction for warp residuals.

3. **Hypothesis** — Detecting the 21 white physical pins (bright on dark board, visible
   through piece holes) in the rectified image gives N≥4 interior correspondences.
   A least-squares DLT homography from detected pin pixels → known grid positions
   corrects residual warp better than 4 noisy corner points.

4. **Files changed**
   - `webapp-v4/src/vision/HomographyComputer.ts` — added `computeHomographyLeastSquares`
     (overdetermined DLT via normal equations for N>4 correspondences).
   - `webapp-v4/src/vision/PinDetector.ts` — new file. PIN_GRID_POSITIONS (21 positions
     from POSITIONS_AROUND_PINS), detectPinsInRectified (brightness-weighted centroid
     search, 20px radius, min luminance 190, min weight 60), computePinRefinedHomography.
   - `webapp-v4/src/vision/visionTypes.ts` — added pinDetectionCount to ScanDebug.
   - `webapp-v4/src/pipeline/DebugArtifacts.ts` — initialized pinDetectionCount: 0.
   - `webapp-v4/src/pipeline/ScanPipeline.ts` — after runRectifiedPass, extract ImageData
     from rectified canvas, detect pins, refit rectifiedToBoardMatrix if ≥4 found.

5. **Why this helps** — 21 interior control points (vs 4 boundary corners) → more stable
   least-squares fit. Pins are bright white on dark board, visible under pieces. The
   refined rectifiedToBoardMatrix is what mapRectifiedPiecesToGrid uses — so piece
   centroids are mapped using pin-calibrated coordinates.

6. **Validation result** — BUILD PASSES (612 modules, tsc -b clean).

7. **Next step** — Run scan-lab. Check debug JSON for pinDetectionCount (expect 15-21).
   If 0, the brightness threshold may need tuning (try lowering PIN_MIN_BRIGHTNESS to 160).
   Verify pieces no longer ambiguous and Mapped view aligns with physical board.

---

## 2026-04-15 rebuild-session-start — Full rebuild kickoff (Claude Opus 4.6)

1. **Inspected**
   - `docs/context/vision-rebuild-context-pack.md`, `docs/prd/vision-rebuild-prd.md`
   - `MEMORY.md` + `project_vision_pipeline.md`
   - Git status (branch `main`); directory state of `webapp-v4/src/{vision,inference,pipeline,app}`
   - `webapp-v4/src/engine/constants.ts`, `BoardCoordinator.ts`, `package.json`
   - `automation/vision-rebuild/` templates

2. **Observed signal**
   - `webapp-v4/src/vision/`, `inference/`, `pipeline/`, `app/` are all EMPTY directories.
     All previous vision files show as deleted in `git status`.
   - `main.tsx` imports `./app/IQNoodlesApp` which does not exist → app does not boot.
   - ONNX model present at `webapp-v4/public/models/yolo26n-seg.onnx`.
   - `engine/` intact (BOARD_WIDTH=14, placements, solver). `BoardCoordinator` present.
   - Historical failures per PRD: frame confusion (center vs. edge corners), over-trimmed
     topRatio (0.1 vs. evidence ~0.055), weak single-source corner scoring, hinge never
     detected, orientation/mirror never solved, no fixture regression harness.
   - No test-images/ directory; only stale debug-output/ scans from 2026-04-10.

3. **Hypothesis** — A clean staged rebuild with typed contracts, multi-candidate
   localization, and a fixture-driven regression harness addresses every root cause
   simultaneously. Restoring-and-patching would perpetuate frame confusion and miss
   orientation/mirror entirely.

4. **Files changed** — NONE (startup/plan phase only). Plan written to
   `C:\Users\abdul\.claude\plans\stateful-dazzling-waterfall.md` and approved by user.

5. **Why this helps** — Documents the zero baseline, failure diagnosis, and approved
   four-phase architecture so any continuation agent can pick up mid-stream.

6. **Validation result** — n/a (plan phase).

7. **Next step** — Begin Phase 1: create typed contracts (`vision/types.ts`,
   `inference/types.ts`, `pipeline/types.ts`), `board/gridGeometry.ts` with the
   edge-based `GRID=14` invariant, stub `app/IQNoodlesApp.tsx`, add smoke tests,
   verify `npm run build && npm run lint && npm run test`.

8. **Memory note** — Prior memory entry `project_vision_pipeline.md` is now stale
   (points at deleted `feature/yolo-broken-v2` code). Will be refreshed at end of
   Phase 4 with new file layout and status.

---

## 2026-04-15 phase-1 — Foundations (contracts, gridGeometry, app shell, tests)

1. **Inspected** — `webapp-v4/src/{main.tsx,engine/constants.ts,board/BoardCoordinator.ts,
   vitest.config.ts,package.json}`; existing engine types and POSITIONS_AROUND_PINS.

2. **Observed signal** — Engine uses BOARD_WIDTH=14 with POSITIONS_AROUND_PINS giving
   the 21 pin quads. No existing single source of truth for the edge-based corner
   frame; prior code scattered ±0.5 math across files, which was the root cause of
   the 34.89 vs 40 px cell spacing drift.

3. **Hypothesis** — Centralizing GRID=14, BOARD_EDGE_MIN/MAX=-0.5/13.5, and
   boardToCanvas/canvasToBoard helpers in one module (gridGeometry.ts) plus defining
   typed contracts for every pipeline stage eliminates frame ambiguity by
   construction. Later stages can only reference the shared constants, not recompute
   them.

4. **Files changed** (all new)
   - `webapp-v4/src/inference/types.ts` — ImageSize, RawDetection, InferenceResult,
     class names + board/hinge ids.
   - `webapp-v4/src/vision/types.ts` — CornerCandidate, BoardRef, Homography,
     RectifiedFrame, PiecePlacement, BoardState.
   - `webapp-v4/src/pipeline/types.ts` — ScanTelemetry (schema v1), ScanResult,
     DebugArtifactBlobs.
   - `webapp-v4/src/board/gridGeometry.ts` — GRID, BOARD_EDGE_*, boardToCanvas,
     canvasToBoard, expectedCellSpacingPx, computePinBoardPoints (21 pin centers
     derived from POSITIONS_AROUND_PINS), snapToCell.
   - `webapp-v4/src/app/IQNoodlesApp.tsx` — minimal shell so `main.tsx` resolves.
   - `webapp-v4/src/dev/ScanLabPage.tsx` — stub dev harness page.
   - `webapp-v4/src/main.tsx` — route `/dev/scan-lab` added.
   - `webapp-v4/src/board/__tests__/gridGeometry.test.ts` — invariant + round-trip
     tests + pin layout assertions.

5. **Why this helps** — Locks in the coordinate contract the old pipeline kept
   violating. Every later stage (locator, rectifier, mapper) imports from
   gridGeometry and types — no stage can silently re-derive a conflicting frame.
   App now boots again (was broken by the missing IQNoodlesApp import).

6. **Validation result** —
   - `npm run test`: 6 files / 39 tests pass (including the 5 new gridGeometry tests).
   - `npm run build`: tsc -b clean, vite production build green (1.27s, 184 kB main).
   - `npm run lint`: zero warnings/errors.
   - Phase-1 acceptance gate: GREEN.

7. **Next step** — Phase 2: implement InferenceRunner (ONNX Runtime Web, letterbox
   preprocess, mask decode, NMS), BoardLocator (≥3 candidate generators + scorer),
   Rectifier (DLT homography + warp + asserted cellSpacingPx invariant), and
   DebugArtifacts (raw/yolo/corners/rectified overlays + partial telemetry).
   Blocker to verify on the user's side: committed fixture images under
   `webapp-v4/test-fixtures/` are needed for the Phase 2 gate; if none exist
   locally, ask the user to drop 3–5 representative JPEGs there.

---

## 2026-04-15 copilot-transition-prep — Phase 2 guardrails + deterministic handoff

1. **Inspected**
  - `webapp-v4/src/vision/BoardLocator.ts`, `webapp-v4/src/vision/Rectifier.ts`
  - Existing test inventory under `webapp-v4/src/**/__tests__/`
  - Handoff templates under `docs/context/`

2. **Observed signal**
  - Phase 2 implementation files existed and compiled, but no dedicated tests covered
    BoardLocator confidence behavior or Rectifier homography math.
  - Copilot handoff docs existed as templates only and were not executable as-is.

3. **Hypothesis**
  - Adding targeted guardrail tests for localization and homography plus filling handoff
    docs with concrete state would enable a clean new-session transition with minimal
    context loss.

4. **Files changed**
  - `webapp-v4/src/vision/__tests__/BoardLocator.test.ts` (new)
  - `webapp-v4/src/vision/__tests__/Rectifier.test.ts` (new)
  - `docs/context/copilot-continuation-handoff.md`
  - `docs/context/copilot-open-risks.md`
  - `docs/context/copilot-next-commands.md`

5. **Why this helps**
  - Tests lock the highest-risk Phase 2 regressions.
  - Handoff docs now provide context, risks, and exact next commands without requiring
    prior chat history.

6. **Validation result**
  - `npm run test`: 8 files / 48 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.

7. **Next step**
  - In a new Copilot session, use the three docs in `docs/context/` as the startup
    packet and execute the commands from `copilot-next-commands.md`.

---

## 2026-04-15 phase2-manual-gate-and-phase3-start

1. **Inspected**
  - `docs/context/copilot-continuation-handoff.md`
  - `docs/context/copilot-open-risks.md`
  - `docs/context/copilot-next-commands.md`
  - `logs/agent-work-log.md` (latest copilot-transition-prep entry)
  - `/dev/scan-lab` fixture runs for all built-in images.

2. **Observed signal**
  - Command sequence re-validation remained green (`test`, `lint`, `build`).
  - Manual fixture gate executed on all 4 fixtures, but all failed with:
    `status=failed`, `cornerSource=fallback_bbox`, `cornerScore=0`,
    `message=no board detection`.
  - Browser console consistently warned that inference outputs 264 classes while
    pipeline expects 13, matching `class_###` labels in report JSONs.

3. **Hypothesis**
  - Phase 2 code contracts are stable, but fixture failure indicates an upstream
    model/class-head mismatch or incompatible model artifact in the dev path.
  - Phase 3 can begin safely with unit-level test-first modules (synthetic
    detections + pure geometry) while keeping the Phase 2 fixture gate marked red.

4. **Files changed**
  - `webapp-v4/debug-output/phase2-manual-gate-2026-04-15/manual-gate-summary.md`
  - `webapp-v4/debug-output/phase2-manual-gate-2026-04-15/*.json` (4 fixture reports)
  - `webapp-v4/debug-output/phase2-manual-gate-2026-04-15/*-corners.png` (4)
  - `webapp-v4/debug-output/phase2-manual-gate-2026-04-15/*-rectified.png` (4)
  - `webapp-v4/src/vision/OrientationMatcher.ts` (new)
  - `webapp-v4/src/vision/PieceMapper.ts` (new)
  - `webapp-v4/src/vision/__tests__/OrientationMatcher.test.ts` (new)
  - `webapp-v4/src/vision/__tests__/PieceMapper.test.ts` (new)
  - `webapp-v4/src/pipeline/ScanPipeline.ts` (mapping integration)

5. **Why this helps**
  - Preserves hard evidence for the Phase 2 gate outcome with reproducible artifacts.
  - Starts Phase 3 through deterministic unit-tested modules:
    - `OrientationMatcher` returns top-K orientation/mirror candidates + ambiguity.
    - `PieceMapper` maps detections into board cells via homography and matcher output.
  - Pipeline now emits mapping telemetry from real mapper output instead of an empty placeholder.

6. **Validation result**
  - `npm run test`: 10 files / 57 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.
  - Phase 2 manual fixture gate: executed but **not accepted** (all fixtures failed localization).

7. **Next step**
  - Resolve model/class mismatch causing missing board detections on fixtures.
  - Re-run Phase 2 fixture gate and require pass criteria before treating Phase 3 as unblocked for full end-to-end accuracy claims.

---

## 2026-04-15 phase2-inference-decode-fix

1. **Inspected**
  - `notebooks/02_train_phase1_synthetic.ipynb`, `03_prepare_real_data.ipynb`,
    `04_train_phase2_finetune.ipynb`, `05_export_and_evaluate.ipynb`
  - `webapp-v4/src/inference/InferenceRunner.ts`
  - `webapp-v4/src/inference/postprocessing.ts`
  - ONNX artifacts:
    - `webapp-v4/public/models/yolo26n-seg.onnx`
    - `data/noodles_training/phase1_synthetic/weights/best.onnx`

2. **Observed signal**
  - Notebooks consistently define 13 classes (`A-K`, `board`, `hinge`).
  - Runtime warning `model outputs 264 classes` came from parsing output0 as raw-head.
  - Direct ONNX inspection showed both models output:
    - `output0: [1, 300, 38]`
    - `output1: [1, 32, 160, 160]`
  - `38 = 6 + 32` indicates end-to-end export (xyxy, score, class_id, mask coeffs),
    not raw `[1, 4+nc+32, numAnchors]` format.

3. **Hypothesis**
  - Board localization failures were primarily a decode-path bug, not missing board class.
  - Supporting end-to-end output decoding in inference should restore board detections,
    remove false class-count warnings, and unblock Phase 2 manual gate.

4. **Files changed**
  - `webapp-v4/src/inference/postprocessing.ts`
    - added `END2END_ATTRS`
    - added `postprocessEnd2End()`
    - refactored shared detection building
  - `webapp-v4/src/inference/InferenceRunner.ts`
    - auto-detects output0 layout and routes to end-to-end vs raw decode path
  - `webapp-v4/src/inference/__tests__/postprocessing.test.ts` (new)
    - row-major and transposed end-to-end decode tests
  - New fixture evidence folder:
    - `webapp-v4/debug-output/phase2-manual-gate-2026-04-15-after-inference-fix/`

5. **Why this helps**
  - Aligns runtime decoding with actual ONNX export format from notebooks.
  - Converts false-negative board detection runs into valid detections and localization.
  - Keeps compatibility for both end-to-end and raw-head exports.

6. **Validation result**
  - `npm run test`: 11 files / 59 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.
  - Re-ran all 4 scan-lab fixtures after fix:
    - status `ok` for all
    - board detected in class histogram for all
    - localization `ok` and `cellSpacingPx=40` for all
  - Phase 2 manual gate after decode fix: **PASS**

7. **Next step**
  - Continue Phase 3 quality hardening: improve orientation confidence and ambiguity tuning,
    add mapped artifact rendering, and validate mapping quality against fixtures and real photos.

---

## 2026-04-15 phase3-cleanroom-mapperv2-checkpoint

1. **Inspected**
  - `docs/context/copilot-continuation-handoff.md`
  - `docs/context/copilot-open-risks.md`
  - `docs/context/copilot-next-commands.md`
  - `webapp-v4/src/vision/PieceMapperV2.ts`
  - `webapp-v4/src/vision/placementIndex.ts`
  - `webapp-v4/src/vision/maskToBoardGrid.ts`
  - `webapp-v4/src/vision/__tests__/PieceMapperV2.test.ts`

2. **Observed signal**
  - Clean-room V2 mapper files were created, but workspace is not green.
  - `npm run test` shows 6 failing tests in `PieceMapperV2.test.ts`.
  - `npm run lint` fails due an unused import in `PieceMapperV2.test.ts`.
  - `npm run build` fails with:
    - unused `AMBIGUITY_MARGIN` import in `PieceMapperV2.test.ts`
    - type mismatch in `placementIndex.ts` (`CanonicalPlacement.orientation`).
  - `ScanPipeline.ts` still routes mapping through V1 only.

3. **Hypothesis**
  - Most failures are V2 implementation/test-contract mismatches, not Phase 2 regressions.
  - Restoring green status requires fixing V2 type/test issues first, then adding an explicit
    V1/V2 mapper selector for runtime A/B validation.

4. **Files changed**
  - `docs/context/copilot-continuation-handoff.md`
  - `docs/context/copilot-open-risks.md`
  - `docs/context/copilot-next-commands.md`
  - `docs/context/copilot-new-session-prompt.md` (new)

5. **Why this helps**
  - Converts stale "all green" handoff docs into the real blocked state.
  - Gives the next Copilot session an exact startup prompt and deterministic first commands.
  - Preserves Phase 2 pass evidence while isolating Phase 3 V2 work-in-progress risk.

6. **Validation result**
  - `npm run test`: 12 files / 69 tests, 6 failed (`PieceMapperV2.test.ts`).
  - `npm run lint`: failed (1 error, 1 warning).
  - `npm run build`: failed (2 TypeScript errors).

7. **Next step**
  - Fix V2 compile/lint blockers and make `PieceMapperV2.test.ts` green.
  - Add `mapperVersion` opt-in in `ScanPipeline` with default `v1`.
  - Run fixture A/B evidence capture (`v1` vs `v2`) before additional tuning.

---

## 2026-04-15 phase3-cleanroom-mapperv2-green-and-ab-gate

1. **Inspected**
  - `docs/context/copilot-continuation-handoff.md`
  - `docs/context/copilot-open-risks.md`
  - `docs/context/copilot-next-commands.md`
  - `logs/agent-work-log.md` (latest checkpoint entry)
  - `webapp-v4/src/vision/PieceMapperV2.ts`
  - `webapp-v4/src/vision/placementIndex.ts`
  - `webapp-v4/src/vision/maskToBoardGrid.ts`
  - `webapp-v4/src/vision/__tests__/PieceMapperV2.test.ts`
  - `webapp-v4/src/pipeline/ScanPipeline.ts`

2. **Observed signal**
  - Reproduced blocker commands exactly from handoff:
    - `git status --short`
    - `cd webapp-v4`
    - `npm run test` (6 failures in `PieceMapperV2.test.ts`)
    - `npm run lint` (unused import error in `PieceMapperV2.test.ts` + warning in `placementIndex.ts`)
    - `npm run build` (unused import + `CanonicalPlacement.orientation` type mismatch)
  - Root causes were localized to clean-room V2 files and pipeline selector gap.

3. **Hypothesis**
  - Fixing the placement index type contract and stabilizing V2 test fixtures should restore green quickly.
  - Adding an explicit mapper selector in `ScanPipeline` should enable runtime A/B evidence without changing default behavior.

4. **Files changed**
  - `webapp-v4/src/vision/placementIndex.ts`
    - removed invalid `orientation` payload from `CanonicalPlacement`
    - removed stale `eslint-disable` no-console directive
  - `webapp-v4/src/vision/__tests__/PieceMapperV2.test.ts`
    - aligned identity-frame synthetic detections with board edge coordinates (`-0.5..13.5`)
    - replaced brittle greedy full-solution fixture generator with solver-backed fixture synthesis
    - resolved unused constant lint error by intentional usage
  - `webapp-v4/src/pipeline/ScanPipeline.ts`
    - added `mapperVersion?: "v1" | "v2"` in options
    - kept default as `"v1"`
    - routed mapping through V2 only when explicitly selected
  - New runtime evidence folder:
    - `webapp-v4/debug-output/phase3-ab-v1-v2-2026-04-15-163106/`
      - 8 report JSONs (`v1-*`, `v2-*`)
      - 32 artifact PNGs (`raw`, `yolo`, `corners`, `rectified` for 4 fixtures x 2 versions)
      - `v1-v2-comparison-summary.md`

5. **Why this helps**
  - Restores deterministic green baseline for Phase 3 clean-room work.
  - Preserves V1 as safe default while enabling controlled V2 opt-in runtime validation.
  - Captures reproducible fixture A/B evidence with confidence and ambiguity deltas for review.

6. **Validation result**
  - After V2 file fixes:
    - `npm run test`: 12 files / 69 tests passed
    - `npm run lint`: passed
    - `npm run build`: passed
  - After ScanPipeline mapper selector integration:
    - `npm run test`: 12 files / 69 tests passed
    - `npm run lint`: passed
    - `npm run build`: passed
  - `/dev/scan-lab` fixture A/B (`v1` vs `v2`) on 4 built-ins:
    - status `ok` for all fixtures in both versions
    - mean confidence delta (V2-V1): `0.000`
    - mean ambiguity delta (V2-V1): `0.000`

7. **Next step**
  - Use the new A/B artifact folder as Phase 3 baseline and introduce targeted V2 scoring improvements only when they produce non-zero quality gains over this baseline.

---

## 2026-04-16 phase3-mapperv2-review — Session resume + code quality review

1. **Inspected**
  - All V2 mapper files: `placementIndex.ts`, `maskToBoardGrid.ts`, `PieceMapperV2.ts`
  - V2 test suite: `__tests__/PieceMapperV2.test.ts` (10 tests)
  - `ScanPipeline.ts` mapper selector wiring
  - `pipeline/types.ts` telemetry schema (has `mapperVersion` field)
  - All handoff docs synced from `docs/context/`

2. **Observed signal**
  - User implemented all V2 files and fixed prior blockers (type mismatches, lint
    errors, test failures). All 69 tests pass, lint clean, build clean.
  - One minor dead-code artifact: `void popcountRowBitmap` in PieceMapperV2.ts
    (unused re-export comment) — cleaned up.
  - V2 mapper follows the CellCoverageMapper spec faithfully: mask warp → cell
    bitmap → IoU scoring against canonical placements → greedy non-overlap →
    homography degradation guard.

3. **Hypothesis** — Code quality is production-ready for Phase 3. No structural
   issues found. The V2 path is correctly gated behind `mapperVersion: "v2"` with
   V1 as default.

4. **Files changed**
  - `webapp-v4/src/vision/PieceMapperV2.ts` — removed dead `void popcountRowBitmap`
    line and unused `popcountRowBitmap` import.

5. **Why this helps** — Eliminates dead code that could mislead future readers.

6. **Validation result**
  - `npm run test`: 12 files / 69 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.

7. **Next step**
  - Wire a V1/V2 toggle in ScanLabPage UI for live fixture comparison.
  - Add mapped-artifact overlay renderer (`renderMappedArtifact`) to DebugArtifacts.
  - Continue toward Phase 4 integration: `IQNoodlesApp.tsx` end-to-end path.

---

## 2026-04-16 phase3-mapped-artifact — Mapped overlay + ScanLabPage tab

1. **Inspected**
  - `webapp-v4/src/pipeline/DebugArtifacts.ts` (existing artifact renderers)
  - `webapp-v4/src/pipeline/ScanPipeline.ts` (artifact emission site)
  - `webapp-v4/src/dev/ScanLabPage.tsx` (tab system + V1/V2 toggle)
  - `webapp-v4/src/vision/types.ts` (BoardState, PiecePlacement)
  - `webapp-v4/src/vision/placementIndex.ts` (CanonicalPlacement.cellSet)

2. **Observed signal**
  - ScanLabPage had 5 tabs (Raw, YOLO, Corners, Rectified, Report) but no Mapped
    tab. Pipeline emitted `artifacts.mapped = undefined` always.
  - V1/V2 toggle was already wired by user. Mapping stats (placed, unassigned,
    ambiguous, confidence) not visible in the summary panel.

3. **Hypothesis** — Adding `renderMappedArtifact` to DebugArtifacts and wiring
   the "Mapped" tab in ScanLabPage will make mapping quality auditable per-piece
   directly in the browser, which is the Phase 3 prerequisite for confidence tuning.

4. **Files changed**
  - `webapp-v4/src/pipeline/DebugArtifacts.ts` — added `renderMappedArtifact()`
    which draws: colored cell fills per placement, piece class labels, orientation
    arrows, ambiguity badges (?), confidence percentages, grid lines, 21 pin
    markers, and a stats legend (placed/unassigned/ambiguous/avgConfidence).
    Uses `getPlacementIndex()` to resolve full cell sets from placement metadata.
  - `webapp-v4/src/pipeline/ScanPipeline.ts` — imported `renderMappedArtifact`,
    emit `artifacts.mapped` when rectifiedCanvas + boardState both exist.
  - `webapp-v4/src/dev/ScanLabPage.tsx` — added "mapped" to Tab type + labels,
    added `mapped` URL to artifact builder, default tab changed to "mapped",
    added mapping summary stats (placed, unassigned, ambiguous, avg confidence).

5. **Why this helps** — The Mapped tab is the primary debug view for validating
   whether the mapper is assigning pieces to the correct cells with correct
   orientation. Without it, mapping quality is only visible in the JSON report.

6. **Validation result**
  - `npm run test`: 12 files / 69 tests passed.
  - `npm run lint`: passed.
  - `npm run build`: passed.

7. **Next step**
  - Start dev server and smoke-test the Mapped tab on all 4 fixtures with both
    V1 and V2 mappers. Capture evidence screenshots.
  - Begin Phase 4: `IQNoodlesApp.tsx` end-to-end integration (capture → scan →
    board view → solver).

---

## 2026-04-17 16:31:13 solved-placement-diagnosis — blender_yolo_generator_v2.py

1. **Inspected**
  - `blender_yolo_generator_v2.py` solved placement path:
    - solver metadata generation (`build_solver_layout_metadata`)
    - solved placement and auto-calibration (`apply_solver_solved_layout`)
    - solved acceptance loop (`_attempt_solved` inside main generation loop)
  - `docs/prd/vision-rebuild-prd.md`
  - `automation/vision-rebuild/state-template.json`

2. **Observed signal**
  - Solved candidate selection computes overlap/spread score, but solved success is currently decided by framing only (`all_pieces_inside_frame`).
  - Auto-calibration can still select candidates with non-zero overlap because overlap is minimized, not hard-gated.
  - No orientation-correctness or solver-cell consistency metric is logged before marking solved success.

3. **Hypothesis**
  - Primary failure mode is an acceptance-gate gap: intersecting layouts can still be marked solved.
  - Secondary failure mode is missing orientation validation: mirrored/rotated states can be wrong without being rejected.
  - Third risk is board-grid extent mismatch causing near-correct but unsolved placements.

4. **Files changed**
  - `docs/prd/vision-rebuild-prd.md`
    - Added Section 12: prioritized solved-scene diagnosis focus, concrete instrumentation, gates A-G, and quick stabilization fix.
  - `automation/vision-rebuild/state-template.json`
    - Updated objective, risks, next actions, and validation checks for solved placement quality hardening.
  - `logs/agent-work-log.md`
    - Added this diagnosis and planning record.

5. **Why this helps**
  - Converts solved-scene quality from best-effort ranking into measurable pass/fail criteria.
  - Ensures overlap, 3D collision, orientation, and grid-consistency are auditable per solved sample.
  - Creates a direct path for fast stabilization before deeper transform/model changes.

6. **Validation result**
  - Planning artifacts updated.
  - No generator code execution/tests run in this planning pass.

7. **Next step**
  - Implement the quick fix first: add hard overlap rejection gate in solved acceptance loop.
  - Add per-attempt diagnostics JSON with candidate and accepted-layout metrics.
  - Run solved-only validation batch and enforce PRD Section 12.3 gates.

---

## 2026-04-17 18:05:00 copilot-handoff-refresh — solved diagnostics script + Blender handoff packet

1. **Inspected**
  - Existing handoff artifacts under `docs/context/`.
  - Handoff workflow requirements in `.claude/skills/claude-to-copilot-handoff/SKILL.md`.
  - Current solved-placement state notes and user feedback (board_inner must be grid).

2. **Observed signal**
  - Existing handoff docs were stale and still focused on webapp-v4 mapper work.
  - No standalone script existed to collect objective solved-placement evidence for board vs board_inner,
    overlap metrics, and per-piece transforms.

3. **Hypothesis**
  - A deterministic diagnostics runner + rewritten continuation docs will reduce context loss and make the
    next-agent debugging pass evidence-driven instead of guess-driven.

4. **Files changed**
  - `automation/vision-rebuild/blender_solved_diagnostics.py` (new)
    - loads `blender_yolo_generator_v2.py`
    - forces board_inner solved-grid mode + calibration
    - renders 12 solved attempts
    - records attempt metrics (inside-frame, overlap, spread, acceptance), board bounds, and per-piece state
    - writes `report.json` and `summary.md` under `debug-output/solved-diagnostics-<timestamp>/`
  - `docs/context/copilot-continuation-handoff.md` (rewritten to Blender scope)
  - `docs/context/copilot-open-risks.md` (rewritten risk register)
  - `docs/context/copilot-next-commands.md` (diagnostics-first command sequence)
  - `docs/context/copilot-new-session-prompt.md` (new-agent startup prompt for this task)

5. **Why this helps**
  - Gives the user and next agent a single-run artifact pack with enough information to separate
    frame-selection errors from threshold-overstrict acceptance.
  - Replaces stale handoff packet with task-accurate instructions and executable continuation steps.

6. **Validation result**
  - `python -m py_compile automation/vision-rebuild/blender_solved_diagnostics.py` passed.
  - Runtime Blender diagnostics not executed in this step (awaiting user scene path/run).

7. **Next step**
  - Run diagnostics script against the active `.blend` scene.
  - Review `report.json` and tune either transform logic or acceptance thresholds based on evidence.


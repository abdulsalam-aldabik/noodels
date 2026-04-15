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


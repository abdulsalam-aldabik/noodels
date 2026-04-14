# Next Agent Handoff Context (2026-04-13)

## 0) Critical User Constraints
- Do NOT open image files via agent tools. User reports agent crashes when images are opened.
- Use JSON/debug text artifacts for diagnosis.
- User expectation: full scan pipeline should work end-to-end; currently user says "the whole thing is not working".
- User preference from memory:
  - Inspect latest scan debug dump first before proposing board-localization changes.
  - Keep scan UI minimal and rely on file-based debug output.
  - Camera flow should stay one-tap in normal path; camera should not auto-start.

---

## 1) What Was Needed (Original Technical Need)
The IQ Noodles scan pipeline needed to:
1. Detect board + pieces reliably from phone/web photos.
2. Localize board orientation and homography correctly.
3. Produce non-cropped, non-tilted rectified board image for second-pass detection.
4. Map detected pieces to grid cells and piece placements without false conflicts/drops.
5. Return stable confirmed placements + usable hint output.
6. Keep privacy constraints (on-device inference, JSON-only outputs).

---

## 2) What Has Been Implemented

### 2.1 Inference + Decode
- Added support for both YOLO output layouts in `webapp-v4/src/inference/postprocessing.ts`:
  - Legacy raw-anchor layout.
  - End-to-end packed detections layout (`[1,300,38]`).
- Added class-space remap in `webapp-v4/src/inference/inferenceTypes.ts`:
  - Model class order A..K mapped to engine internal piece IDs.

### 2.2 Board Localization
- Implemented candidate-based board corner extraction in `webapp-v4/src/vision/BoardLocator.ts`:
  - YOLO candidate.
  - OpenCV contour candidate.
  - Optional hybrid candidate.
- Added scoring and selection among candidates.
- Added hinge-prior canonical fallback when hinge confidence is missing/weak.
- Later replaced YOLO hull extreme-point cornering with oriented-rectangle fit from mask hull to reduce tilt.

### 2.3 Rectified Second Pass
- Added `webapp-v4/src/vision/RectifiedDetector.ts` for canonical warp + second-pass inference.
- Fixed rectified crop issue by introducing margin-aware geometry:
  - `RECTIFIED_MARGIN_CELLS = 1.25`.
  - Added `RectifiedGeometry` with origin offsets (`boardOriginCol`, `boardOriginRow`) + scale.
- Propagated geometry through:
  - `webapp-v4/src/vision/PieceMapper.ts` (rectified mapping uses origin offsets).
  - `webapp-v4/src/pipeline/ScanPipeline.ts` (passes geometry through pipeline).
  - `webapp-v4/src/pipeline/DebugArtifacts.ts` (grid/coverage overlay aligned with origin offsets).

### 2.4 Piece Assignment + Validation Flow
- Added/updated:
  - `webapp-v4/src/vision/CellCoverage.ts`
  - `webapp-v4/src/pipeline/PieceAssigner.ts`
  - `webapp-v4/src/pipeline/PartialStateValidator.ts`
- Implemented global assignment and coverage-based placement resolution.
- Fixed key bug: coverage matching now constrained to the globally assigned candidate cell (prevents post-assignment drift into conflicting placements).

### 2.5 Capture UX + Debugging
- Added guided in-app camera framing + hinge-top guide in `webapp-v4/src/app/CaptureView.tsx` and `webapp-v4/src/styles/app.css`.
- Added debug artifact persistence pipeline:
  - `webapp-v4/src/pipeline/DebugArtifacts.ts`
  - `webapp-v4/vite-plugins/debug-output-plugin.ts`
- Added OpenCV loading/proxy support:
  - `webapp-v4/src/vision/OpenCVProcessor.ts`
  - `webapp-v4/vite.config.ts`

---

## 3) Current Observed Behavior from Debug JSON (No Images)

Latest available run history sampled from `webapp-v4/debug-output/scan-*.json`:

| Run | boardDetected | boardSource | det | rectifiedUsed | rectDet | mapped | confirmed | dropped | errorStage |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| 2026-04-10T16:57–17:06 | false | (none) | 22–33 | false | 0 | 0 | 0 | - | board_localization |
| 2026-04-10T17:24–17:54 | true | mask_hull | 5 | true | 2 | 4 | 3 | 5 | (none) |
| 2026-04-10T18:03–18:04 | true | mask_oriented_rect | 5 | true | 4 | 4 | 3 | 5 | (none) |

Repeated warning in recent successful-localization runs:
- `Piece 5: dropped due to conflict with piece(s) 3`

Key interpretation:
- Board localization recovered from total failure state.
- Decoder mismatch issue appears resolved (packed detections parsed correctly).
- Rectified second-pass detections improved from 2 to 4 in latest runs.
- End-to-end placement quality remains insufficient (persistent drop/conflict, user still reports system not working).

---

## 4) What Works Now
1. Build/lint are passing in normal dev flow.
2. Board is detected in latest runs (`boardDetected=true`).
3. `boardCornerSource` progressed from `mask_hull` to `mask_oriented_rect` in latest runs.
4. Rectified pass executes and returns detections (`rectifiedSecondPassUsed=true`, `rectDet` increased).
5. Debug artifacts and JSON telemetry are being produced consistently.

---

## 5) What Still Does Not Work (User-Reported + Evidence)
1. User says the system still does not work end-to-end.
2. Rectified result still perceived as wrong/tilted by user despite fixes.
3. Persistent assignment conflict leads to dropped piece (`dropped=5`) in repeated runs.
4. Hinge detection is typically absent (`hingeDetected=false`, `hingeConfidence=0`).
5. Practical output quality is still below usability target for reliable board state extraction.

---

## 6) Realizations (Important Lessons Learned)
1. The ONNX export is end-to-end packed output; decoding as raw anchor logits caused garbage detections.
2. Model class IDs and engine piece IDs differ; explicit remap is mandatory.
3. Using convex-hull extreme points for quadrilateral corners can produce unstable/tilted homography.
4. Rectifying exactly to board span (0..13 only) clips edges; margin + origin-aware geometry are required.
5. Allowing coverage matching to choose unconstrained placements after global assignment reintroduces conflicts.
6. Even with improved geometry, the assignment/placement stage can still fail on ambiguity-heavy inputs.

---

## 7) Outstanding Technical Risks / Suspected Root Causes
1. Board corner selection may still pick a suboptimal candidate in some viewpoints.
2. Corner ordering ambiguity can still occur under near-symmetric views.
3. Piece placement conflict logic may be too strict or tie-breaking is biased.
4. Thresholds for candidate generation / ambiguity / coverage may need retuning against real photos.
5. Hinge detector absence removes a strong orientation anchor; current fallback may be insufficient.

---

## 8) Current Code Hotspots for Next Agent
- Inference decode + class map:
  - `webapp-v4/src/inference/postprocessing.ts`
  - `webapp-v4/src/inference/inferenceTypes.ts`
- Board localization and orientation:
  - `webapp-v4/src/vision/BoardLocator.ts`
- Rectified warp + geometry:
  - `webapp-v4/src/vision/RectifiedDetector.ts`
  - `webapp-v4/src/vision/PieceMapper.ts`
- Assignment/validation:
  - `webapp-v4/src/vision/CellCoverage.ts`
  - `webapp-v4/src/pipeline/PieceAssigner.ts`
  - `webapp-v4/src/pipeline/PartialStateValidator.ts`
- Orchestration and debug:
  - `webapp-v4/src/pipeline/ScanPipeline.ts`
  - `webapp-v4/src/pipeline/DebugArtifacts.ts`

---

## 9) Suggested Immediate Plan for Next Agent
1. Do not inspect images; inspect only latest JSON telemetry.
2. Add additional JSON telemetry to board localization:
  - all corner candidates,
  - candidate scores,
  - selected candidate + reason.
3. Add temporary feature flag for rectified pass:
  - `YOLO_ONLY_CORNERS=true` (disable CV/hybrid selection) for A/B runs.
4. Run 5–10 scans and compare drop/conflict rates across:
  - YOLO-only corners,
  - CV-only corners,
  - hybrid scoring.
5. If persistent conflict remains, instrument assignment stage with per-piece candidate score breakdown and rejected-overlap reasons.

---

## 10) Build/Quality State Notes
- Build passes (sometimes requires `--emptyOutDir false` if Windows locks `dist/models` while dev server is active).
- Lint passes.
- Non-blocking quality warnings still present from analyzer:
  - `ScanPipeline.ts` cognitive complexity.
  - `postprocessing.ts` cognitive complexity/style suggestions.

---

## 11) Workspace / Git Delta Context
Repository is very dirty (many staged/unstaged + untracked files, including generated `dist/` artifacts). Next agent should avoid broad cleanups or destructive git commands and focus only on targeted fixes.

---

## 12) Explicit Handoff Summary
- Significant infrastructure and geometry fixes are implemented.
- System improved from "no board detected" to "board detected + partial mapping".
- Core product objective still not met per user: reliable end-to-end scan is not achieved yet.
- Next work should be evidence-driven with JSON telemetry and strict A/B isolation of board-corner strategy and assignment behavior.

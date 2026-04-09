# Agent Handoff: Mapping + Camera (2026-04-09)

## Current user-reported issues
- Not all pieces are detected.
- Detected pieces still have incorrect orientations.
- Camera flow expectation: press one scan action -> capture -> close camera.

## Latest evidence from debug output
Source file: debug-output/scan-debug-latest.json
- ok: true
- totalDetections: 9
- pieceDetections: 8
- piece labels detected: F, B, K, A, E, D, I, H
- mappedCount: 3
- confirmedCount: 0
- imagePath and overlayPath are present in debug output

Interpretation:
- Detector finds several pieces in this frame, but mapping and validation collapse most of them.
- Orientation/placement stage is the main failure point right now.

## Mapping pipeline summary
Pipeline file: webapp-v4/src/pipeline/ScanPipeline.ts
1) Preprocess image
2) ONNX inference
3) Decode detections and masks
4) Board localization and hinge orientation
5) Piece to board mapping
6) Partial-state validation (drop conflicts/low confidence)
7) Solver hint generation

Debug payload records all stage timings, detections, mappings, and confirmed placements.

## What was tried in mapping, and results

### 1) Model output decoding fix (worked)
File: webapp-v4/src/inference/postprocessing.ts
- Added support for direct class-id output format and class-logit format.
- Key references: format detection and decode path around lines 121, 132, 139, 402.
Result:
- This fixed the early hard failure where board/piece decode was wrong.
- Detections now appear in debug with plausible labels/confidence.

### 2) NMS + cross-class piece suppression (partial)
File: webapp-v4/src/inference/postprocessing.ts
- Per-class NMS retained.
- Added cross-class suppression for overlapping piece boxes.
- Key references around lines 245 and 266.
Result:
- Reduced duplicate/conflicting piece boxes.
- Did not solve orientation correctness.

### 3) Board polygon fallback and hinge-based orientation (partial)
File: webapp-v4/src/vision/BoardLocator.ts
- Board polygon fallback to bbox corners if mask polygon is weak.
- Hinge interpretation used to rotate corners before final homography.
- Key references around lines 41-49, 63-67, 84-94, 141-168.
Result:
- Board localization is more robust than before.
- Hinge still missing in many real photos, so orientation fallback can remain unstable.

### 4) Map only inside board (worked as constraint)
File: webapp-v4/src/vision/PieceMapper.ts
- Added hard gating: piece centroid must be inside detected board polygon.
- Added board-space bounds gate after homography projection.
- Key references around lines 105-117.
Result:
- Prevents obvious outside-board false mappings.
- Also drops aggressive detections when board localization is slightly off.

### 5) Orientation scoring improvements (partial)
File: webapp-v4/src/pipeline/PartialStateValidator.ts
- Added shape-fit score and blended scoring for placement selection.
- Added confidence-aware ordering and dynamic threshold.
- Key references around lines 28-66 and 97-106.
Result:
- Better than nearest-cell-only logic.
- Still not reliable enough in real phone photos.

### 6) Full debug artifact export (worked)
Files:
- webapp-v4/src/app/CaptureView.tsx
- webapp-v4/vite.config.ts
Result:
- Writes JSON + raw image + YOLO overlay image to debug-output for each scan.
- This is now the primary evidence source for iteration.

## What is still not working
1) End-to-end accuracy target is not reached; not all pieces map and confirmed placements can be zero.
2) Orientation is still unstable in practical photos.
3) Hinge class is often absent in detections, forcing weaker orientation fallback.
4) Current mapping is local/greedy and not globally optimized across all pieces.

## Camera history and current status

### What was broken before
- Camera started automatically on page load.
- Primary button required a second tap (enable first, scan second).
- In fallback paths it could open native camera app unexpectedly.

### What was changed now
File: webapp-v4/src/app/CaptureView.tsx
- Removed auto-start camera effect.
- Primary action now does one-tap flow via handleOneTapScan:
  - start in-app camera
  - capture frame
  - run scan
  - stop camera
- Key references: stopLiveCamera line ~169, handleStartLiveCamera line ~183, handleLiveCapture line ~237, handleOneTapScan line ~268, primary button onClick line ~356.

### Remaining camera caveat
- In-app camera still requires secure context and permission. If not available, app cannot do live camera and will show native-mode note.

## Most likely root causes for mapping/orientation misses
1) Board orientation uncertainty when hinge is not detected.
2) Single-pass detection on perspective-distorted image.
3) Greedy mapping/validation decisions under ambiguous piece geometry.
4) Threshold interactions that are still conservative after board gating.

## Recommended next implementation order for the next agent
1) Board-rectified second-pass detection
- Detect board first, warp to canonical top-down board image, then run piece detection on rectified crop.
- This should reduce orientation ambiguity significantly.

2) Global assignment optimizer
- Replace greedy drop logic with global optimization over piece-cell-orientation candidates.
- Objective should combine detection confidence, cell confidence, shape fit, and no-overlap constraints.

3) Multi-frame consensus
- Capture 3 to 5 frames and vote per piece class/cell/orientation.
- Use temporal consistency to reduce one-frame noise.

4) Hinge robustness
- Improve hinge confidence handling and fallback orientation estimator from board geometry if hinge absent.

5) Threshold calibration from real debug corpus
- Build per-class precision/recall stats from debug-output and tune class-specific thresholds.

## Quick pointers for the next agent
- Main orchestration: webapp-v4/src/pipeline/ScanPipeline.ts
- Decoder and suppression: webapp-v4/src/inference/postprocessing.ts
- Board and hinge orientation: webapp-v4/src/vision/BoardLocator.ts
- Piece mapping gates: webapp-v4/src/vision/PieceMapper.ts
- Placement resolution: webapp-v4/src/pipeline/PartialStateValidator.ts
- Camera UX: webapp-v4/src/app/CaptureView.tsx

## Build status
- Latest build after one-tap camera patch: successful.

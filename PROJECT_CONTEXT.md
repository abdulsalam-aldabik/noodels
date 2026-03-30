# Project Context — IQ Noodles Detection System

> Comprehensive findings from deep-dive analysis (2026-03-30), updated 2026-03-30.
> Purpose: onboarding reference, architecture record, root-cause history.

**Hardware constraint:** The physical toy is a final commercial product. Nothing can be added to it (no markers, stickers, ArUco tags, etc.). All board localization must rely solely on existing visual features: the board outline shape and the **hinge** at the top of the board.

---

## 1. Game Overview

**IQ Noodles** is a physical puzzle by Smart Games. The board holds 11 curved "noodle" pieces that fit between 21 cylindrical pins. The goal is to place all pieces so their paths connect without overlapping.

### Board Grid Model

| Property | Value |
|----------|-------|
| Grid size | 14 × 14 (196 total positions) |
| Valid cells | 81 (108 are permanently blocked/missing) |
| Physical pins | 21 |
| Pieces | 11 (labels A–K) |

Each **pin** occupies the centre of a 2 × 2 block of cells. A piece's path is defined by which 2×2 blocks it runs through. The piece physically threads *around* the pin (the pin goes through a hole in the piece).

### Cell Coordinate System

```
position = row * 14 + col        (row ∈ [0,13], col ∈ [0,13])
```

Board-space graphical coordinates (used for rendering and detection):
- Origin at centre of board
- x right, y down
- Total extent: **−7.9 to +7.9** in both axes (span = 15.8 units)

### 21 Pin Positions (board-space)

```
Pin  0: (-1.8, -5.6)   Pin  1: ( 1.8, -5.6)
Pin  2: (-3.6, -3.6)   Pin  3: ( 0.0, -3.6)   Pin  4: ( 3.6, -3.6)
Pin  5: (-5.4, -1.8)   Pin  6: (-1.8, -1.8)   Pin  7: ( 1.8, -1.8)   Pin  8: ( 5.4, -1.8)
Pin  9: (-3.6,  0.0)   Pin 10: ( 0.0,  0.0)   Pin 11: ( 3.6,  0.0)
Pin 12: (-5.4,  1.8)   Pin 13: (-1.8,  1.8)   Pin 14: ( 1.8,  1.8)   Pin 15: ( 5.4,  1.8)
Pin 16: (-3.6,  3.6)   Pin 17: ( 0.0,  3.6)   Pin 18: ( 3.6,  3.6)
Pin 19: (-1.8,  5.4)   Pin 20: ( 1.8,  5.4)
```

### Segment Types

| Type | Meaning |
|------|---------|
| `CURVE` (0) | 90° bend at this pin |
| `CROSS_NS` (1) | Path goes straight North–South |
| `CROSS_EW` (2) | Path goes straight East–West |

### 11 Pieces

| Label | Cells | Color (RGB) |
|-------|-------|-------------|
| A | 6 | (249, 214, 94) Yellow |
| B | 6 | (8, 167, 232) Sky Blue |
| C | 6 | (32, 109, 217) Dark Blue |
| D | 8 | (31, 161, 91) Green |
| E | 8 | (238, 57, 79) Red |
| F | 8 | (133, 218, 187) Teal |
| G | 8 | (236, 113, 168) Pink |
| H | 8 | (199, 120, 185) Purple |
| I | 8 | (252, 105, 12) Orange |
| J | 10 | (182, 48, 72) Dark Red |
| K | 8 | (149, 212, 80) Yellow-Green |

Each piece has up to 8 distinct orientations (4 rotations × optional reflection).

---

## 2. YOLO Model Specification

### Model

- Architecture: **YOLOv8-nano-seg** (`yolo26n-seg`) — 2.7 M parameters
- Task: **Instance segmentation** (polygon-level piece outlines)
- Input size: 640 × 640 px
- Output:
  - `output0`: shape `(1, 300, 38)` — 300 detections × [x1, y1, x2, y2, conf, classId, 32 mask_coeffs]
  - `output1`: shape `(1, 32, 160, 160)` — 32 prototype masks

### Classes (11)

Classes 0–10 correspond to pieces A–K in the color order above. The model was trained to detect pieces **by color** — class 0 = Yellow (A), class 10 = Yellow-Green (K), etc.

### Training Pipeline

| Phase | Data | Epochs | mAP@0.5 |
|-------|------|--------|---------|
| Phase 1 — Synthetic | 1600 Blender renders (1024×1024) | 100 | 0.9947 |
| Phase 2 — Real fine-tune | 104 real photos | 50 | 0.9647 |

**Synthetic data details (Blender):**
- Camera: 15 units above origin, strictly top-down (0° tilt)
- Pieces randomly placed within radius 3.5 units, full 360° rotation, ±5° tilt
- Board present in ~25% of images (currently background only, not labelled)
- Labels: YOLO polygon segmentation format, normalized [0,1]

**Important:** The current model detects piece *type* (color), not position. It does **not** detect the board or hinge.

### Planned Retraining — Add Board & Hinge Classes

To eliminate manual calibration entirely, the model needs 2 additional classes:

| Class | Name | Type | Purpose |
|-------|------|------|---------|
| 11 | `board` | Segmentation mask | Board outline → bounding quad → auto homography |
| 12 | `hinge` | Bounding box | Top-edge position + rotation → board orientation |

**The hinge** is a mechanical hinge on the physical board used to open/close the box. It sits at the **top edge** of the board at a fixed position relative to the board centre. Detecting it gives:
- Which direction is "up" (orientation disambiguation)
- Approximate top-edge pixel position
- Board rotation angle

Combined with the board segmentation mask, this enables fully automatic `computeHomography()` with zero user interaction.

**Implementation in `blender_yolo_generator.py`:** The board mesh is already rendered. Add the hinge as a separate Blender mesh object at the correct physical location. When `board_visible`, label both the board outline and the hinge bbox. Also annotate both in the Roboflow real-data set.

---

## 3. Frontend Architecture (`webapp-v2/`)

### Tech Stack

- React + Vite + TypeScript
- ONNX Runtime Web (WASM, SharedArrayBuffer — requires COOP/COEP headers in `vite.config.ts`)
- SVG board rendering

### Data Flow

```
ImageCapture
  → runInference (inference.ts)
    → ONNX model (best.onnx, 640×640 letterboxed input)
    → decodeDetections → decodeMasks
  → ResultsOverlay (user drag-calibrates 4 reference points → homography H)
  → mapDetectionsToBoard (gridMapper.ts)
    → centroid of each mask → board-space via H
    → nearest valid placement per piece
  → BoardView (SVG, 440×440, 26px/unit)
  → solve (solver.ts, backtracking + MRV heuristic, 5 s timeout)
  → hint display
```

### App Phases

| Phase | State | Screen |
|-------|-------|--------|
| `capture` | idle | Camera / file upload |
| `results` | detections available | Detection overlay + calibration |
| `board` | pieces mapped | SVG board view + Solve button |
| `solved` | solution found | Animated hint overlay |

### Key Files

| File | Role |
|------|------|
| `src/inference.ts` | ONNX inference, mask decoding |
| `src/board/gridMapper.ts` | Detection → placement mapping |
| `src/board/homography.ts` | Perspective transform utilities |
| `src/board/board.ts` | Grid model, pins, valid cells |
| `src/board/pieces.ts` | 11 piece definitions |
| `src/board/orientations.ts` | Rotation/reflection generation |
| `src/board/placements.ts` | Pre-computed valid placements |
| `src/board/solver.ts` | Backtracking solver |
| `src/components/ResultsOverlay.tsx` | Detection overlay + calibration UI |
| `src/components/BoardView.tsx` | SVG board renderer |
| `src/App.tsx` | Phase orchestration, state management |

---

## 4. Root Cause Analysis — Why Mapping Was Broken

### Bug 1 — Checking pin *centers* inside masks (fundamental logic error)

The old `gridMapper.ts` projected each pin's graphical center to pixel space, then checked if that single pixel was inside the segmentation mask.

**Why this is wrong:** Noodle pieces slot *around* pins. The physical pegs protrude through holes in the pieces. The pin center is often *outside* the mask (a gap/hole in the piece at the peg location).

### Bug 2 — Mask resolution too coarse for single-pixel checks

YOLO proto masks are `160×160` (1/4 of the 640px input), then bilinearly upscaled. At this resolution, each pin-region in the proto space is only ~3–6 px. Single-point sampling at noisy mask boundaries is unreliable.

### Bug 3 — No perspective correction

The old calibration was a draggable axis-aligned rectangle (`{minX, minY, width, height}`). Any phone tilt (even 10°) causes the linear `offset / width * span` transform to be wrong. Pieces near the edges of the board were systematically mis-located.

### Bug 4 — Loose Jaccard threshold (0.15)

The pin-match threshold was set very low to compensate for bugs 1–2. This accepted many incorrect placements, cascading errors through the board state.

---

## 5. Implemented Fix

### Phase 1 — Centroid-based matching (`gridMapper.ts`)

**Replaced:** pin-point-in-mask checks + Jaccard scoring
**With:** mask centroid → board-space → nearest placement centroid

Algorithm:
1. Compute `(mean_x, mean_y)` of all mask pixels with `alpha > 50`
2. Transform centroid to board-space using calibration (homography or linear fallback)
3. For each valid, unoccupied placement of this piece type, compute its board-space centroid = mean of `PIN_COORDINATES[pin]` for all covered pins
4. Pick the placement with minimum Euclidean distance (reject if > 2.5 board units)

This is robust because:
- Centroid is stable even with blurry mask edges
- No dependency on pin-center pixel accuracy
- Works regardless of zoom level

### Phase 2 — 4-point perspective homography (`ResultsOverlay.tsx`, `homography.ts`)

**Replaced:** draggable rectangle
**With:** 4 labeled reference points at known pin positions

Reference pins (chosen for max spatial spread):

| Label | Pin | Board-space |
|-------|-----|-------------|
| Top | 0 | (-1.8, -5.6) |
| Right | 8 | (5.4, -1.8) |
| Left | 12 | (-5.4, 1.8) |
| Bottom | 20 | (1.8, 5.4) |

The user drags each coloured dot to the corresponding physical pin visible in the photo. The component computes a `3×3` perspective homography `H` (DLT with Gauss-Jordan elimination) and emits it via `onCalibrationChange(H)`.

`H` maps any pixel `(px, py)` → board-space `(bx, by)` via:
```
w  = H[6]·px + H[7]·py + H[8]
bx = (H[0]·px + H[1]·py + H[2]) / w
by = (H[3]·px + H[4]·py + H[5]) / w
```

---

## 6. Solver Details

- Algorithm: Backtracking with **MRV** (Minimum Remaining Values) heuristic — always tries the piece with fewest valid placements remaining
- Pruning: Checks connectivity of empty cells (prevents unreachable pockets)
- Timeout: 5 seconds (configurable)
- Returns: `{ solved, solution, timeMs, statesExplored, timedOut }`

---

## 7. Known Limitations & Future Work

| Issue | Severity | Path to fix |
|-------|----------|-------------|
| Manual calibration (4-point drag) | Medium | Retrain with `board` + `hinge` classes → auto homography |
| Camera tilt > ~30° degrades results | Low–Medium | Homography corrects moderate perspective; wider-angle training data helps |
| Partially occluded pieces | Medium | More real-data images in Roboflow, especially partially occluded |
| Only strictly top-down synthetic training | Low | Add ±20° camera tilt variation in Blender generator |
| Only IQ Noodles supported | — | IQ Puzzler Pro / IQ Waves planned (different grid models, new board classes) |

### Next priority: Automatic calibration via board + hinge detection

Once classes 11 (`board`) and 12 (`hinge`) are added:

```
runInference()
  detections.filter(d => d.label === 'board') → board mask
  detections.filter(d => d.label === 'hinge') → hinge bbox

Auto-calibrate:
  1. Fit bounding quadrilateral to board mask contour
  2. Use hinge position to identify the top edge
  3. Map quad corners to known board-space coordinates
  4. computeHomography(pixelCorners, boardCorners) → H
  5. mapDetectionsToBoard(pieceDets, { H }) → zero user interaction
```

The current `mapDetectionsToBoard` already accepts `{ H: number[] }` — no gridMapper changes needed once auto-calibration is wired up.

---

## 8. Development Commands

```bash
cd webapp-v2/
npm run dev       # Dev server with HMR
npm run build     # TypeScript + Vite production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

No test infrastructure yet. Planned: Vitest (frontend), pytest (FastAPI backend).

---

## 9. Java Reference Implementation

Original game logic ported from `archive/java_reference/`:

| Java File | TS Equivalent |
|-----------|---------------|
| `GridNoodles.java` | `board/board.ts` |
| `PiecesNoodles.java` | `board/pieces.ts` |
| `BigGridNoodles.java` | `board/orientations.ts` |
| `PlacingsOnNoodlesGrid.java` | `board/placements.ts` |
| `Grid.java` | `board/board.ts` (BoardState) |
| `Pieces.java` | `board/pieces.ts` |
| `PieceData.java` | types/pieces |

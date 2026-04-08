# Project Context — IQ Noodles Detection System

> Comprehensive findings from deep-dive analysis (2026-03-30), updated 2026-04-07.
> Purpose: onboarding reference, architecture record, root-cause history.

**Hardware constraint:** The physical toy is a final commercial product. Nothing can be added to it (no markers, stickers, ArUco tags, etc.). All board localization must rely solely on existing visual features: the board outline shape and the **hinge** at the top of the board.

---

## 1. Game Overview

**IQ Noodles** is a physical puzzle by Smart Games. The board holds 11 curved "noodle" pieces that fit between 21 cylindrical pins. The goal is to place all pieces so their paths connect without overlapping.

### Board Grid Model

| Property | Value |
|----------|-------|
| Grid size | 14 × 14 (196 total positions) |
| Valid cells | 84 (112 are permanently blocked/missing) |
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

Each piece has up to 8 distinct orientations (4 rotations x optional reflection).

### webapp-v3 Status Note (2026-04-07)

- Engine parity and build checks are passing.
- 3D piece rotation/mirror behavior has been stabilized using per-piece board tuning in `webapp-v3/src/iq-noodles-app/boardPieceTuning.ts`.
- Final manual verification confirmed full rotate-cycle correctness for previously problematic mirrored cases (notably pieces 5 and 9).

---

## 2. YOLO Model Specification

### Model

- Architecture: **YOLOv8-nano-seg** (`yolo26n-seg`) — 2.7 M parameters
- Task: **Instance segmentation** (polygon-level piece outlines)
- Input size: 640 × 640 px
- Output:
  - `output0`: shape `(1, 300, 38)` — 300 detections × [x1, y1, x2, y2, conf, classId, 32 mask_coeffs]
  - `output1`: shape `(1, 32, 160, 160)` — 32 prototype masks

### Classes (13)

Classes 0–10 correspond to pieces A–K in the color order above. Class 11 is the board segmentation mask. Class 12 is the hinge bounding box.

| Class | Name | Type | Purpose |
|-------|------|------|---------|
| 0–10 | A–K pieces | Segmentation mask | Piece detection by color |
| 11 | `board` | Segmentation mask | Board outline → bounding quad → auto homography |
| 12 | `hinge` | Bounding box | Top-edge position + rotation → board orientation |

### Training Pipeline

| Phase | Data | Epochs | mAP@0.5 |
|-------|------|--------|---------|
| Phase 1 — Synthetic | 1600 Blender renders (1024×1024) | 100 | 0.9947 (11-class) |
| Phase 2 — Real fine-tune | 104 real photos | 50 | 0.9647 (11-class) |

**Full retrain required:** Adding classes 11+12 requires resizing the YOLO detection head. Must retrain from COCO pretrained weights, not the existing 11-class model.

**Synthetic data details (Blender):**
- Camera: 15 units above origin, strictly top-down (0° tilt)
- Pieces randomly placed within radius 3.5 units, full 360° rotation, ±5° tilt
- Board + hinge present in ~25% of images (`use_board = random.random() < 0.25`)
- Labels: YOLO polygon segmentation format for pieces + board; YOLO bbox format for hinge
- Board mask: Rendered in isolation via Workbench → alpha channel → `cv2.findContours` → polygon
- Hinge bbox: Rendered in isolation → alpha → bounding box → normalized (cx, cy, w, h)

### Board + Hinge Implementation in `blender_yolo_generator.py`

**Key constants:**
```python
HINGE_RADIUS_FRAC = 0.04   # cylinder radius = 4% of board world-space width
HINGE_DEPTH_FRAC  = 0.05   # protrusion past board edge = 5% of board width
```

**Critical design decision — hinge is NOT parented to the board:**
The `auto_scale_and_flatten()` function applies a rotation to lay the board flat based on its thinnest axis, which scrambles any child object's local-space position. Instead, the hinge is a **standalone object** repositioned in **world space** each frame after the board's transform is applied, using the board's world-space bounding box to find the actual top edge.

**Key functions:**
- `create_or_get_hinge()` — creates a unit cylinder (standalone, not parented)
- `position_hinge_on_board(board_obj)` — positions hinge in world space each frame using board's `matrix_world @ bound_box` corners
- `render_board_mask(scene, res_x, res_y)` — renders board in isolation → segmentation polygon
- `render_hinge_bbox(scene, res_x, res_y)` — renders hinge in isolation → YOLO bbox

### Real Data Annotations (Roboflow)

The real photo dataset (`data/noodles_finetune_dataset/`) currently only has piece annotations (classes 0–10). Board and hinge annotations must be added manually in Roboflow. See `ROBOFLOW_ANNOTATION_GUIDE.md` for instructions.

Until Roboflow annotations are added, Phase 2 fine-tuning trains on pieces only; board+hinge detection relies solely on Phase 1 synthetic pre-training.

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
| Camera tilt > ~30° degrades results | Low–Medium | Homography corrects moderate perspective; wider-angle training data helps |
| Partially occluded pieces | Medium | More real-data images in Roboflow, especially partially occluded |
| Only strictly top-down synthetic training | Low | Add ±20° camera tilt variation in Blender generator |
| Only IQ Noodles supported | — | IQ Puzzler Pro / IQ Waves planned (different grid models, new board classes) |
| Board+hinge Roboflow annotations missing | Medium | Annotate in Roboflow per ROBOFLOW_ANNOTATION_GUIDE.md |

### Automatic calibration via board + hinge detection (in progress)

Once the 13-class model is trained:

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

---

## 10. Board + Hinge Implementation History (2026-03-30/31)

This section documents errors encountered and fixes applied during the board+hinge class implementation to avoid repeating mistakes.

### Files Modified

| File | Change |
|------|--------|
| `blender_yolo_generator.py` | Added hinge mesh, board/hinge mask rendering, label writing |
| `data/yolo_dataset/dataset.yaml` | nc=13, added board+hinge names |
| `data/noodles_finetune_dataset/dataset.yaml` | nc=13, added board+hinge names + TODO |
| `notebooks/02_train_phase1_synthetic.ipynb` | NUM_CLASSES=13, ALL_CLASS_NAMES |
| `notebooks/04_train_phase2_finetune.ipynb` | NUM_CLASSES=13, TODO about Roboflow |
| `notebooks/05_export_and_evaluate.ipynb` | NUM_CLASSES=13, guarded cls_id lookup |
| `ROBOFLOW_ANNOTATION_GUIDE.md` | Created — Roboflow annotation instructions |
| `dataset_viewer.py` | Created — dataset analysis + annotation viewer |
| `test_board_hinge.py` | Created — quick Blender test for board+hinge |

### Error 1 — FileNotFoundError during training (notebook 02)

**Symptom:** `Dataset 'yolo_dataset/dataset.yaml' images not found, missing path '.../notebooks/images/val'`

**Cause:** `dataset.yaml` had `path: .` which Ultralytics resolved relative to the notebook's CWD (`notebooks/`), not the dataset directory.

**Fix:** Changed `path` to absolute path in both yaml files:
- `data/yolo_dataset/dataset.yaml` → `path: /home/salumi/projects/project/data/yolo_dataset`
- `yolo_dataset/dataset.yaml` → `path: /home/salumi/projects/project/yolo_dataset`

### Error 2 — Hinge has 0 instances after generation

**Symptom:** Board (class 11) labels present, but hinge (class 12) had zero instances in the entire dataset.

**Cause:** Original hinge dimensions were absolute board-local units (`HINGE_RADIUS=0.18`, `HINGE_DEPTH=0.35`). The board mesh is hundreds of local units wide. After `auto_scale_and_flatten` scales the board to ~12 world units, the hinge became sub-pixel.

**Fix:** Changed to fractional constants relative to board world-space width:
```python
HINGE_RADIUS_FRAC = 0.04   # 4% of board width
HINGE_DEPTH_FRAC  = 0.05   # 5% of board width
```

### Error 3 — ModuleNotFoundError in test script

**Symptom:** `ModuleNotFoundError: No module named 'blender_yolo_generator'` when running `test_board_hinge.py`.

**Cause:** `__file__` doesn't resolve reliably in Blender's embedded Python.

**Fix:** Changed `PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))` to `PROJECT_ROOT = os.path.dirname(bpy.data.filepath)`.

### Error 4 — Hinge placement wrong (parenting issue)

**Symptom:** Hinge visible as thin line in renders but bbox extraction fails. Hinge appeared at wrong position/orientation.

**Cause:** The hinge was **parented to the board**. `auto_scale_and_flatten()` applies a rotation based on the thinnest axis to lay the board flat. This rotation scrambles any child object's local-space position — the hinge's local Z offset got rotated to a different axis, making it nearly invisible or edge-on to camera.

**Fix:** Complete rewrite of hinge approach:
1. `create_or_get_hinge()` creates a **standalone** unit cylinder (NOT parented to board)
2. New `position_hinge_on_board(board_obj)` positions hinge in **world space** each frame AFTER board transform is applied
3. Uses `board_obj.matrix_world @ bound_box` corners to find actual world-space top edge
4. Called from `prepare_hdri_background()` after board transform is set

**Status (2026-03-31):** Fix written to files but NOT YET TESTED. Next step: run `blender --background scene.blend --python test_board_hinge.py`

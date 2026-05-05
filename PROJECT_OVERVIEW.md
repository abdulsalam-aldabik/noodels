# Smart NV — IQ Noodles Vision System
### Project Overview (as of 2026-05-05)

---

## What This Project Is

A mobile-to-dashboard computer vision system for Thomas More University research. A phone captures a photo of a physical **IQ Noodles** puzzle board, runs on-device YOLO segmentation to detect which pieces are placed, solves the remaining puzzle, and generates progressive hints on a secondary dashboard display.

**Privacy constraint:** Photos never leave the device. Only a JSON grid state (piece positions) is transmitted over the network.

**Hardware constraint:** Nothing can be added to the physical toy. All localization relies on visually detecting features already present on the board — primarily the board outline and the hinge at the top.

**Target games:** IQ Noodles (current MVP, fully implemented), IQ Puzzler Pro, IQ Waves (planned).

---

## Repository Structure

```
project/
├── webapp-v4/          ← Active frontend (React + Vite + Three.js)
├── notebooks/          ← ML pipeline (YOLO training, Blender synthetic data)
├── data/               ← Raw + processed datasets
├── yolo_dataset/       ← YOLO-formatted training set
├── antigravity_export/ ← Export artifacts
├── phone-debug/        ← Real phone debug captures
├── logs/               ← Agent work logs
├── scripts/            ← Root-level utility scripts
├── docs/               ← Project documentation
├── archive/            ← Old code (v1, v2, v3 iterations)
└── CLAUDE.md           ← Instructions for Claude Code
```

Only `webapp-v4/` is active. Earlier versions (v2, v3) are archived.

---

## webapp-v4 — Frontend App

**Package:** `iq-noodles-v4` v1.0.0

### Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| React | 19.2.4 | UI framework |
| TypeScript | 5.9.3 | Type safety |
| Vite | 8.0.1 | Dev server + bundler |
| ONNX Runtime Web | 1.24.3 | On-device YOLO inference (WASM) |
| Three.js | 0.181.1 | 3D piece rendering |
| React Three Fiber | 9.4.0 | React bindings for Three.js |

### Dev Commands (run from `webapp-v4/`)

```bash
npm run dev       # Vite dev server with HMR → http://localhost:5173
npm run build     # TypeScript + Vite production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

### `vite.config.ts` Note

Sets **COOP/COEP headers** required for `SharedArrayBuffer` (WASM multithreading). Do not remove — ONNX Runtime will break.

---

## Source Directory Layout (`webapp-v4/src/`)

```
src/
├── app/            ← React UI components (phase orchestration)
├── engine/         ← Core game logic (board, solver, pieces)
├── rendering/      ← Three.js 3D scene components
├── vision/         ← Computer vision pipeline modules
├── pipeline/       ← End-to-end scan pipeline orchestrator
├── board/          ← Board coordinate system utilities
├── pieces/         ← Piece asset definitions and tuning
├── inference/      ← ONNX Runtime integration
├── hooks/          ← React state hooks (solver, placements)
├── ui/             ← Reusable UI components
├── dev/            ← Debug/calibration pages
└── styles/         ← CSS (dark theme, mobile layout)
```

---

## User-Facing Flow

```
Camera Live View
  → [Framing overlay guides board alignment]
  → Capture photo
  → YOLO inference (on-device, ~1-2s)
  → Board localization + rectification
  → Piece mapping
  → [ScanRetryPrompt if quality checks fail]
  → Review placed pieces
  → [Apply] → IQNoodlesApp
  → Solver runs → progressive hints displayed
```

### App Components (`src/app/`)

| Component | Role |
|-----------|------|
| `CameraCaptureView.tsx` | Full-screen camera orchestrator; states: `starting → live → loading → scanning → review` |
| `CameraFramingOverlay.tsx` | SVG dashed square + corner brackets + crosshair; tap to dismiss |
| `ScanRetryPrompt.tsx` | Shows when scan quality fails; buttons: "Retake Photo" / "Use Anyway" |
| `IQNoodlesApp.tsx` | Main game view after scan; renders 3D board + piece inventory + hints |
| `BoardGhostOverlay.tsx` | Ghost overlay of unplaced pieces |
| `CaptureView.tsx` | Alternative capture entry point |

### Retry Conditions (in `ScanRetryPrompt.tsx`)

| Condition | Emoji | Trigger |
|-----------|-------|---------|
| Homography unstable | 📐 | Condition number > 5,000 |
| Grid misaligned | 📏 | Grid residual > 0.15 |
| Too few pieces placed | 🔍 | Placed count < 5 |
| High ambiguity | ❓ | Ambiguous > placed count |

---

## Vision Pipeline (`src/pipeline/` + `src/vision/`)

### `ScanPipeline.ts` — Orchestrator Phases

1. **Two-stage YOLO detection**
   - First pass: full image → detect board region
   - Crop to board (+ 5% padding) → re-infer to boost piece confidence
   - Skip crop if board fills >85% of frame
   - NMS IoU threshold: `0.3`

2. **Board localization** (`BoardLocator.ts`)
   - Corner-based homography
   - Optional pin refinement (`PinLocator` → `BoardLocatorPins`)
   - Default inset ratios: `topRatio=0.062`, `sideRatio=0.03`, `bottomRatio=0.03`

3. **Rectification** (`Rectifier.ts`)
   - Warp board to 960×960 px canonical canvas (60 px/cell for 16-cell span)
   - Compute SVD condition number → reject if > 5,000
   - Bilinear backward warp

4. **Piece mapping** (`PieceMapper.ts`)
   - Color-classify cells (CIE Lab perceptual distance)
   - Fit color groups to canonical piece placements
   - YOLO-backed pieces prioritized (score > 0.25)
   - Configurable ambiguity policy: `"strict" | "lenient" | "off"` (default: `"off"`)

5. **Retry evaluation** — emits `RetryCondition[]` for UI

### `ColorCellClassifier.ts` — Key Thresholds

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_PIECE_DISTANCE` | 45 | Max CIE Lab distance to classify as a piece color |
| `MIN_PIECE_LIGHTNESS` | 16 | Board plastic L < 25; pieces always brighter |
| `PIECE_VS_BOARD_MARGIN` | 8 | Extra margin to distinguish piece from board |
| `PATCH` | 4 | Half-size of 9×9 sampling patch |
| `HIGHLIGHT_MAX_LUM` | 245 | Specular highlight cutoff |
| Board reference RGB | [40, 42, 45] | Dark board plastic |
| Pin reference RGB | [160, 160, 165] | Light grey pins |

White-balance normalization: samples dark-plastic frame at corner cutouts, scales per-channel to match board reference.

### `PieceMapper.ts` — Assignment Algorithm

1. Color-classify all valid cells
2. Group cells by color, fit to canonical placements
3. Score candidates: YOLO-backed first, then hit count, then fewest extra cells
4. Greedy global assignment with conflict + uniqueness checks
5. Confidence blend: **70% color hit ratio + 30% YOLO score** when YOLO-backed

### `Rectifier.ts` — Homography Details

- Normalized DLT (Direct Linear Transform) for 3×3 homography
- Condition number: σ_max / σ_min via eigenvalues of M^T·M
- Well-conditioned: < 100 | Degenerate: > 5,000
- Canvas: `DEFAULT_RECTIFIED_CANVAS = 960` px

---

## Board Game Logic (`src/engine/`)

### IQ Noodles Board Model

- **Grid:** 14×14 = 196 positions, **84 valid cells**, **21 intersection pins**
- `MISSING_POSITIONS`: corners and edges cut off to match physical board shape
- `POSITIONS_AROUND_PINS`: maps each pin index to its 4 surrounding cell positions
- Position encoding: `position = row * 14 + col`

### Pieces

**11 curved pieces** (A–K), each defined by:
- `bigGridPositions`: cell indices the piece occupies
- `shapes`: rotations + flip variants
- Two **connector endpoints** (first + last positions) that grip board pins
- Middle positions are tube body segments

### Solver (`engine/solver.ts`)

- Backtracking solver with **MRV heuristic** (Minimum Remaining Values)
- Returns: solution array, timing, states explored
- Default timeouts: **5s** for solve, **2s** for validate
- `getHint()`: returns next piece placement for progressive hint system

---

## 3D Rendering (`src/rendering/`)

### `BoardScene3D.tsx`

- React Three Fiber `<Canvas orthographic>`
- Renders placed 3D piece models in world space
- `GLOBAL_OFFSET_X = -0.5` cell units (horizontal correction)
- `CameraSync` syncs orthographic zoom to board pixel density

### `PieceModel3D.tsx`

- Loads OBJ models from `/public/models/piece_X.obj`
- `GLOBAL_MODEL_SCALE = 3.6508` (empirically calibrated)
- Per-piece tuning: base rotation steps, mirrored flag, residual offsets/scale
- OBJ files are **pre-centered at connector midpoint** by `align_piece_objs.py`

### Coordinate System

```
Board space:  row/col (0–13), origin top-left
Board pixel:  x = 40 + col*28, y = 40 + row*28  (cellSize=28px, padding=40px)
World space:  x = boardPx - 222, y = 222 - boardPx (center at 0, flip Y)
Board size:   444px = 2*40 + 13*28
```

### Piece Alignment Chain

1. `IQNoodlesApp.tsx`: Identify two **gripping pins** (maximum separation) → compute `centerRow/centerCol` as their midpoint
2. `align_piece_objs.py` (one-time setup): Center each OBJ at connector midpoint via PCA
3. `BoardScene3D.tsx`: Convert row/col to world point → apply rotation → apply residual offsets

### Per-Piece Tuning (`pieces/tuning.ts`)

Each of the 11 pieces has a `BoardPieceTuning` entry:
- `baseRotationSteps`: display-only orientation correction (0–3)
- `baseMirrored`: whether piece appears mirrored
- `invertRotationWhenMirrored` / `swapEvenStepsWhenMirrored`: mirroring behavior
- `orientationOffsets`: per-orientation world-space offset corrections (cell units)
- `residualScale`: scale fine-tuning

---

## Piece Assets (`src/pieces/assets.ts`)

11 pieces with colors calibrated from phone captures (2026-04-29):

| ID | Key | Color |
|----|-----|-------|
| 0  | A   | Dark Red |
| 1  | B   | Dark Blue |
| 2  | C   | Purple |
| 3  | D   | Sky Blue |
| 4  | E   | Yellow |
| 5  | F   | Yellow-Green |
| 6  | G   | Orange |
| 7  | H   | Pink |
| 8  | I   | Green |
| 9  | J   | Teal |
| 10 | K   | Red |

OBJ models at: `/models/piece_A.obj` through `/models/piece_K.obj`

---

## YOLO Model (`yolo26n-seg`)

**13 classes:**
- 0–10: Piece classes A–K
- 11: `board` — full board outline segmentation polygon
- 12: `hinge` — barrel hinge bounding box (top of board, indicates orientation)

**Training pipeline (2 phases):**
1. Phase 1: Synthetic data from Blender (pieces + board, no hinge)
2. Phase 2: Fine-tune on real photos with all 13 classes (hinge annotated in Roboflow)

**Known issue:** `hingeSnapped: false` always — hinge not reliably detected. May be model quality or limited real training data.

---

## UI Theme (`src/styles/app.css`)

Dark theme, mobile-first:

| Variable | Value |
|----------|-------|
| `--bg-a` | `#07111f` (deep navy) |
| `--bg-b` | `#0e2238` (dark blue) |
| `--accent` | `#ffbf3f` (gold) |
| `--accent-2` | `#64d2b2` (teal) |

Camera view: fullscreen `100dvw/100dvh`, `topbar` with orientation chip ("Hinge up ↑"), `bottombar` with shutter button and "Advanced" link. Review panel slides up from bottom.

---

## Debug & Development Tools

### ScanLabPage (`src/dev/ScanLabPage.tsx`)

Multi-tab debug harness at `http://localhost:5173/dev/scan-lab`:

| Tab | Shows |
|-----|-------|
| Raw | Original captured image |
| YOLO | Raw detections with confidence scores |
| Corners | Board corner candidates + scoring |
| Rectified | Warped 960×960 canonical board |
| Detections | Piece detections on rectified board |
| Colors | Color-classified cells |
| Mapped | Final piece placement on grid |
| Report | Full telemetry JSON + metrics |

Built-in test fixtures: loads `webapp-v4/test-images/20260414_144554.jpg`.

### PieceCalibrationPage (`src/dev/PieceCalibrationPage.tsx`)

Interactive 3D piece calibration with live nudge controls for residual offset X/Y and scale per piece per orientation.

---

## Pipeline Telemetry (`src/pipeline/types.ts`)

`ScanTelemetry` schema captures:
- Inference metadata (model, timing, class scores)
- Localization stats (corner candidates, condition number)
- Rectification stats (cell spacing, grid fit residual)
- Mapping stats (placed count, ambiguous count, per-piece confidence)
- UI retry info (conditions triggered, user decision)

---

## Known Issues & Open Items

1. **Hinge detection unreliable** — `hingeSnapped: false` in all recent scans; board orientation defaults to assumption
2. **Per-orientation offsets only tuned for orientation 0** — other orientations fall back to `residualOffsetX/Y` (mostly undefined)
3. **topRatio may need further tuning** — current 0.062 based on April debug evidence; use "Sweep Top Inset" in ScanLabPage
4. **sideRatio/bottomRatio validation** — old evidence: 0.024/0.028; current default: 0.03/0.03

---

## Architecture Note (No Backend)

Originally, a Python FastAPI backend was planned. **This is now cancelled.** The entire application, including the solver, game logic, and computer vision, runs purely on the client side (in-browser) using WebAssembly/WebGL to ensure maximum privacy and offline capability.

---

## Key File Quick Reference

| Area | File |
|------|------|
| Pipeline orchestrator | `src/pipeline/ScanPipeline.ts` |
| Board localization | `src/vision/BoardLocator.ts` |
| Rectification | `src/vision/Rectifier.ts` |
| Color classification | `src/vision/ColorCellClassifier.ts` |
| Piece mapping | `src/vision/PieceMapper.ts` |
| Camera UI | `src/app/CameraCaptureView.tsx` |
| Retry prompt | `src/app/ScanRetryPrompt.tsx` |
| Framing overlay | `src/app/CameraFramingOverlay.tsx` |
| Main game view | `src/app/IQNoodlesApp.tsx` |
| Board model | `src/engine/board.ts` |
| Solver | `src/engine/solver.ts` |
| Piece definitions | `src/engine/constants.ts` |
| 3D scene | `src/rendering/BoardScene3D.tsx` |
| 3D piece model | `src/rendering/PieceModel3D.tsx` |
| Piece assets | `src/pieces/assets.ts` |
| Piece tuning | `src/pieces/tuning.ts` |
| ONNX runner | `src/inference/InferenceRunner.ts` |
| Scan lab debug | `src/dev/ScanLabPage.tsx` |
| Piece calibration | `src/dev/PieceCalibrationPage.tsx` |
| Grid geometry | `src/board/gridGeometry.ts` |
| Pipeline types | `src/pipeline/types.ts` |

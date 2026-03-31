# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart NV Computer Vision Puzzle Tracking System — a research project for Thomas More University. A mobile-to-dashboard system where a phone captures a photo of a physical puzzle board, runs on-device YOLO segmentation to detect pieces, solves the puzzle, and generates progressive hints displayed on a secondary dashboard device.

**Target games:** IQ Noodles (current MVP focus), IQ Puzzler Pro, IQ Waves.

**Key privacy constraint:** Photos are never transmitted. Only JSON grid state (piece positions) is sent over the network.

**Hardware constraint:** Nothing can be added to the physical toy (no markers, stickers, or modifications). The toy is a final commercial product. All localization must rely on visually detecting features already present on the board — primarily the board outline and the **hinge** at the top of the board.

---

## Commands

All commands run from `webapp-v2/`:

```bash
npm run dev       # Start Vite dev server with HMR
npm run build     # TypeScript compile + Vite production build
npm run lint      # Run ESLint
npm run preview   # Preview production build locally
```

No test infrastructure is set up yet. Planned: Vitest for frontend, pytest for backend.

---

## Architecture

### Frontend (`webapp-v2/src/`)

Single React + Vite app serving both the phone client and dashboard. ONNX Runtime Web runs YOLO26n-seg inference entirely on-device via WASM.

**Data flow:**
```
ImageCapture → runInference (ONNX/YOLO) → ResultsOverlay (user calibrates 4 ref points → homography H)
  → mapDetectionsToBoard (mask centroid → board-space via H → nearest placement)
  → solve → getHint → BoardView
```

**Key modules:**

| File | Role |
|------|------|
| `App.tsx` | Orchestrates phases: capture → results → board → solved |
| `inference.ts` | ONNX Runtime Web integration, YOLO preprocessing, mask decoding |
| `board/board.ts` | IQ Noodles 14×14 grid definition (81 valid cells, 21 pins) |
| `board/pieces.ts` | 11 piece definitions |
| `board/orientations.ts` | All piece rotations/flips |
| `board/placements.ts` | Valid piece placements on board |
| `board/solver.ts` | Backtracking solver with MRV heuristic and timeout |
| `board/gridMapper.ts` | Maps detections → board: centroid-distance matching, homography or linear fallback |
| `board/homography.ts` | 3×3 perspective homography (DLT), pixel ↔ board-space transforms |
| `constants.ts` | Model path, confidence thresholds, piece labels/colors |
| `types.ts` | Shared TypeScript interfaces (`Detection`, `InferenceResult`, `ModelStatus`) |

### ML Pipeline (`notebooks/`, `data/`)

Five Jupyter notebooks for the full training pipeline: synthetic data generation (Blender) → initial YOLO training → real data preparation → fine-tuning → export to ONNX. `blender_yolo_generator.py` drives the Blender scene (`scene.blend`) to render synthetic training images.

**Current model (yolo26n-seg):** 13 classes — 11 piece classes (A–K, indices 0–10) + board (11) + hinge (12).

**Class 11 `board`:** Segmentation polygon of the full board outline. Generated in Blender by rendering the board in isolation and extracting the contour via `cv2.findContours`. Working correctly.

**Class 12 `hinge`:** Bounding box of the barrel hinge at the top of the board. The hinge is a full-width cylindrical bar spanning the entire top edge (the physical hinge that opens/closes the box). It determines board orientation ("which edge is up"). **Not generated in synthetic data** — the Blender cylinder doesn't look realistic enough. Hinge annotations come from real photos only (Roboflow fine-tuning dataset).

**Important implementation detail — hinge positioning:** The hinge must NOT be parented to the board in Blender. `auto_scale_and_flatten()` applies a rotation to lay the board flat (based on its thinnest axis), which scrambles any child's local-space position. Instead, the hinge is a standalone object repositioned in world space each frame after the board's transform is applied, using the board's world-space bounding box to find the actual top edge.

**Training pipeline:** Full retrain from COCO pretrained weights (not the old 11-class model) because adding classes requires resizing the YOLO detection head. Phase 1 trains on 13-class synthetic data (pieces + board only, no hinge). Phase 2 fine-tunes on real photos with all 13 classes (board + hinge annotations added in Roboflow — see `ROBOFLOW_ANNOTATION_GUIDE.md`).

**Test script:** `test_board_hinge.py` — renders 5 test frames with board+hinge visible, validates mask extraction, saves annotated previews to `test_output/`. Run before full dataset generation to verify hinge placement.

### Planned Backend (not yet implemented)

Python 3.11 + FastAPI + PostgreSQL. Will handle multi-game solver variants (Algorithm X / Dancing Links), session management, and cross-device dashboard sync via REST API at `/api/v1/`.

---

## Vite Configuration Note

`vite.config.ts` sets required COOP/COEP headers for ONNX Runtime Web's SharedArrayBuffer usage. Do not remove these headers — WASM multi-threading will break.

---

## Game Grid Models

- **IQ Noodles:** 14×14 grid, only 81 cells valid, 21 intersection pins, 11 curved pieces. Graph-based model.
- **IQ Puzzler Pro:** 5×11 = 55-cell standard polyomino grid, 12 pieces.
- **IQ Waves:** 4×8 = 32 H/V slot grid, 8 wave pieces.

Board logic was ported from an existing Java reference implementation.

# Blender Generation Takeover — Execution Log (2026-04-17)

## PASS/FAIL Summary

| Check | Result | Key metric |
|---|---|---|
| **Solved diagnostics** (Step A) | **PASS** | accepted_count=11, best_overlap_sum=2.01 ≤ 3.5, board_inner_exists=true |
| **Smoke generation validation** (Step B) | **PASS** | 6 train + 2 val images/labels, class 11 present, all class IDs ∈ [0,11], all coords ∈ [0,1] |

## Environment

- Branch: `blender-solved-diagnostics-handoff`
- Scene: `C:\Users\abdul\Desktop\noodels\scene.blend` (only `.blend` at repo root)
- Blender: `D:\blender.exe` (5.1.0, build 2026-03-17) — discovered via registry lookup; not on PATH; not in default `Program Files\Blender Foundation\`
- Blender Python deps: `cv2=4.13.0`, `numpy=2.3.4`, `yaml=6.0.3` — all present, no bootstrap needed

## Command log

```bash
# Git / branch
git status -s
git branch --show-current           # blender-solved-diagnostics-handoff

# Blender discovery (registry lookup) → D:\blender.exe
/d/blender.exe --version

# Dependency check
/d/blender.exe -b --python-expr "import cv2, numpy, yaml; print('DEPS_OK', cv2.__version__, numpy.__version__, yaml.__version__)"

# Phase 1 — Solved diagnostics
/d/blender.exe scene.blend --background --python automation/vision-rebuild/blender_solved_diagnostics.py

# Phase 2 — Smoke dataset generation
/d/blender.exe scene.blend --background --python automation/vision-rebuild/smoke_runner_temp.py

# Phase 2 — Label validation
python automation/vision-rebuild/validate_smoke_dataset.py
```

## Artifacts

- **Latest solved diagnostics:** `debug-output/solved-diagnostics-20260417-222844/`
  - `report.json`, `summary.md`, `attempt_00.png` … `attempt_11.png`
- **Smoke dataset:** `debug-output/smoke-yolo-dataset/`
  - `images/train/*.png` (6), `images/val/*.png` (2)
  - `labels/train/*.txt` (6), `labels/val/*.txt` (2)
  - `dataset.yaml`
  - `validation-report.json`, `validation-report.md`

## Phase 1 metrics (solved-diagnostics-20260417-222844)

```
board_inner_exists       : true
board_exists             : true
accepted_count           : 11  (of 12 attempts)
best_overlap_sum         : 2.0118
SOLVED_ACCEPT_MAX_OVERLAP : 3.5
inside_frame true count  : 11
board      bounds        : x[-70.99, 70.80] (w=141.79)  y[-70.08, 69.92] (h=139.99)  aspect=1.013
board_inner bounds        : x[-53.37, 60.72] (w=114.09)  y[-62.23, 62.11] (h=124.34)  aspect=0.918
```

## Phase 2 class histogram (smoke-yolo-dataset)

```
class 0 : 1    class 1 : 1    class 2 : 1    class 3 : 2
class 4 : 1    class 5 : 2    class 6 : 2    class 9 : 1
class 11: 8    (class 7, 8, 10 absent — expected in small 8-image smoke run)
class 12: 0    (hinge — not synthesized, per CLAUDE.md)
```

## board_inner aspect-ratio note (user flagged concern)

The webapp virtual grid is a **square 14×14** ([webapp-v4/src/board/gridGeometry.ts:12-21](../webapp-v4/src/board/gridGeometry.ts)): `BOARD_EDGE_CORNERS` = (-0.5,-0.5) → (13.5,13.5). To match this corner-to-corner, `board_inner` in Blender must have an aspect ratio (w/h) of **1.000 ± ~0.01**.

**Current state:**
- `board_inner` aspect = **0.918** (114.09 wide × 124.34 tall) — **~8% off square**.
- `board` aspect = 1.013 — essentially square.

**Interpretation:** `board_inner` mesh in `scene.blend` is **not** aligned corner-to-corner with the webapp's 14×14 playable grid. The outer `board` is square (as expected), but `board_inner` is rectangular. This is a **scene geometry issue**, not a code issue — Blender units are independent from webapp units (only aspect ratio matters), and the generator already uses `board_inner` for the solved grid (`USE_BOARD_INNER_FOR_SOLVED_GRID=True`) and for the class-11 label mask (`BOARD_LABEL_USE_INNER_MASK=True`).

**Fix requires interactive Blender** — open `scene.blend`, select `board_inner`, and resize/reshape so its bounds form a square whose corners coincide with the outermost pin quads. Cannot be done safely from a headless script.

Despite the aspect-ratio mismatch, the current gate still passes: pieces are placed consistently and overlap stays low (2.01 ≪ 3.5 threshold). The mismatch would show up in downstream homography if the webapp assumes a square grid and the generator produces labels for a rectangular one — worth fixing before a full 1920/480 dataset generation run.

## Code changes

**None to `blender_yolo_generator_v2.py`** (auto-fix loop was not triggered — both phases passed on first run).

**New files added under `automation/vision-rebuild/`:**
- `validate_smoke_dataset.py` — reusable label validator (class IDs, coord ranges, expected counts, class-11 presence).

No unrelated refactors.

## Recommended next steps for the user

1. **Open `scene.blend` in Blender interactively** and resize/reshape `board_inner` so its bounds are square and align corner-to-corner with the four outermost pin quads (cells `(0,0), (13,0), (13,13), (0,13)` in webapp grid coords).
2. Re-run `automation/vision-rebuild/blender_solved_diagnostics.py` and confirm `board_inner` aspect = 1.00 in the new report.
3. Once aspect matches, run the full dataset: `/d/blender.exe scene.blend --background --python blender_yolo_generator_v2.py` (1920 train + 480 val).

## Verification commands (for re-running this takeover later)

```bash
/d/blender.exe scene.blend --background --python automation/vision-rebuild/blender_solved_diagnostics.py
/d/blender.exe scene.blend --background --python automation/vision-rebuild/smoke_runner_temp.py
python automation/vision-rebuild/validate_smoke_dataset.py
```

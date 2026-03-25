# Project Charter: Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Academic Year** | 2025–2026 |
| **Institution** | Thomas More University |
| **Client** | Smart NV |
| **Project Type** | Research Phase Initiative |
| **Date** | March 4, 2026 |

---

## 1. Introduction

This document is the official Project Charter for the **Smart NV Computer Vision Puzzle Tracking System**, a research-phase initiative commissioned by Smart NV. It formally establishes the project's purpose, scope, objectives, stakeholders, risks, and planning.

The charter covers: background on the client and their challenge; high-level functional and non-functional requirements; in-scope vs. out-of-scope work; a risk assessment; a phased sprint plan; and the **complete game-specific data models** for all target puzzles: IQ Puzzler Pro (front 2D + back 2D modes), IQ Noodles, and IQ Waves.

**Key design decision:** The system uses **Algorithm X with Dancing Links (DLX)** to solve puzzles live from any partial board state detected by the CV pipeline. The user selects which puzzle they're playing, scans the board, and the solver computes a complete solution in real-time — no pre-encoded challenge database needed.

---

## 2. Background

### 2.1 Client

Smart NV is a Belgian toy and game manufacturer specializing in logic-based puzzle games for children and families. Their product portfolio includes physical board games such as the IQ Puzzler Pro, IQ Noodles, and IQ Waves. Smart NV designs, manufactures, and distributes these products internationally.

Smart NV is exploring how digital technology can enhance the physical play experience. This project represents their first foray into computer vision and AI-assisted gameplay, with the strategic goal of building a commercially viable digital companion.

### 2.2 Current Situation

Smart NV's puzzle games are entirely analog. When players — typically children aged 8+ — get stuck on a challenge, there is no digital support. Players must rely on the printed solution booklet (which requires literacy) or ask an adult for help. This creates friction and can lead to frustration, disengagement, or game abandonment.

No existing system detects the physical state of a Smart NV puzzle board using a camera, nor does any tool provide contextual hints based on placed pieces. The company has no internal CV capability and no labeled training dataset.

### 2.3 New User Flow

1. **User selects game** from a menu (IQ Puzzler Pro / IQ Noodles / IQ Waves)
2. **User scans the board** by taking a photo with their phone
3. **CV pipeline detects** which pieces are placed and where
4. **DLX solver computes** a valid solution for the remaining empty spaces
5. **Hints are generated** from the solver's output (3 progressive tiers)
6. **Dashboard displays** real-time board state, hints, and completion detection

---

## 3. Project Vision and Goals

### 3.1 Vision Statement

Create a computer-vision-powered digital companion that detects physical game states and provides real-time solving assistance for Smart NV puzzles, bridging the gap between physical hardware (the game) and digital assistance (contextual hints).

### 3.2 Primary Goal

Transform frustration into engagement by providing age-appropriate, real-time guidance to children ages 8+ solving Smart NV puzzles, without requiring literacy or constant parental intervention.

### 3.3 Business Goals

- Reduce player frustration and game abandonment rates
- Differentiate Smart NV products through innovative AI integration
- Build technical foundation for a scalable digital companion ecosystem
- Generate valuable usage data for future product development
- Explore new revenue models (freemium features, puzzle packs) in future phases

---

## 4. The Three Target Games

### 4.1 IQ Puzzler Pro

| Property | Value |
|----------|-------|
| **Board** | 5 rows × 11 columns = 55 circular cells |
| **Grid type** | Simple rectangular cell grid |
| **Pieces** | 12 colored polyomino pieces (3–5 balls each) |
| **Rotations** | 4 (0°, 90°, 180°, 270°) |
| **Flipping** | Yes (mirror); 5 pieces are symmetric |
| **Max orientations/piece** | 8 (4 rot × 2 flip), fewer for symmetric |
| **Complexity** | ⭐ Low |
| **Scope** | Front 2D + Back 2D modes (3D pyramid is out of scope) |

**Piece definitions** (binary matrix format):

| ID | Color | Balls | Shape Matrix |
|----|-------|-------|-------------|
| A | Pink | 5 | `[[1,1,0,0],[0,1,1,1]]` |
| B | Cyan | 5 | `[[1,1,1],[1,1,0]]` |
| C | Orange | 5 | `[[1,0,0],[1,1,1],[0,1,0]]` |
| D | Purple | 5 | `[[1,1,0],[0,1,1],[0,0,1]]` |
| E | Yellow | 5 | `[[1,1,1,1],[0,1,0,0]]` |
| F | Cherry | 4 | `[[1,1,0],[0,1,1]]` |
| G | Green | 4 | `[[1,1,1],[0,1,0]]` |
| H | Blue | 5 | `[[1,1,1],[1,0,0],[1,0,0]]` |
| I | Red | 5 | `[[1,1,1,1],[1,0,0,0]]` |
| J | Olive | 5 | `[[1,1,1],[1,0,1]]` |
| K | Dark Blue | 4 | `[[1,1,1],[1,0,0]]` |
| L | Sky | 3 | `[[1,1],[1,0]]` |

> **Total: 12 pieces × varying balls = 55 balls = fills the 5×11 board exactly.**
>
> **Diagonal connectivity note:** Piece D `[[1,1,0],[0,1,1],[0,0,1]]` forms a staircase where some adjacent balls are connected only diagonally (not sharing a row or column edge). Piece L `[[1,1],[1,0]]` similarly has a diagonal link between `(0,1)` and `(1,0)`. On the physical board, all balls within a piece are connected via a rigid plastic frame, so diagonal adjacency is valid. However, the polyomino placement algorithm must treat these as **standard polyominoes on a cell grid** (each `1` occupies one cell), not as requiring diagonal adjacency — the shape matrix already encodes the correct footprint.

**Board representation:** A 5×11 2D array where each cell stores `null` (empty) or a piece ID (`A`–`L`).

**Placement format:** `[piece_id, row, col, orientation_index]`

> **Note:** `piece_id` (A–L) is the canonical identifier. Color is a secondary YOLO output attribute used for visual display only — never as a primary key, since lighting variation can make similar colors ambiguous.

#### 4.1.1 IQ Puzzler Pro — Back Side 2D Mode (Diagonal 2D)

| Property | Value |
|----------|-------|
| **Mode ID** | `IQ_PUZZLER_PRO_BACK_2D` |
| **Board** | 8 columns × 5 rows = 40 theoretical cells (with inactive cells removed) |
| **Grid type** | Rectangular cell grid with active-cell mask |
| **Pieces** | Same 12 colored polyomino pieces as front 2D mode (A–L) |
| **Rotations** | 4 (0°, 90°, 180°, 270°) |
| **Flipping** | Yes (mirror); same symmetry properties as front mode |
| **Max orientations/piece** | 8 (4 rot × 2 flip), fewer for symmetric |
| **Orientation angle** | 45° — board is held/placed at 45° relative to the player |
| **Complexity** | ⭐ Low (same pieces as front 2D) |

**Board structure:** The back/bottom face of the IQ Puzzler Pro board is an 8-column × 5-row base grid (40 theoretical cells) with specific slots physically removed at the corners and periphery. The remaining active area forms a connected region that visually resembles 3 interlocking diamond (rhombus) shapes when the board is oriented at 45°. All 12 puzzle pieces are the same as the front 2D mode. The total active cells must equal the sum of all piece ball counts (verify against physical board).

**Inactive cell map** (⚠️ to be verified physically in Sprint 0):

Represent the board as an 8×5 binary matrix where `1` = active slot, `0` = removed/inactive slot. The removed slots form the corners and edges that create the 3-diamond silhouette.

```
⚠️ Placeholder — verify against physical board in Sprint 0:
Row 0: [0, 1, 1, 1, 1, 1, 1, 0]
Row 1: [1, 1, 1, 1, 1, 1, 1, 1]
Row 2: [1, 1, 1, 1, 1, 1, 1, 1]
Row 3: [1, 1, 1, 1, 1, 1, 1, 1]
Row 4: [0, 1, 1, 1, 1, 1, 1, 0]
```

> **Action required (Sprint 0):** Physically map the exact 8×5 back grid binary matrix and count the exact number of active cells. Document the verified matrix before challenge encoding begins.

**Data model:**

```python
BOARD_BACK_2D = {
    "mode": "IQ_PUZZLER_PRO_BACK_2D",
    "rows": 5,
    "cols": 8,
    "active_cells": [...],  # list of (row, col) tuples — verify physically
    "orientation_angle": 45,  # board held at 45° relative to player
    "pieces": "same 12 pieces as front 2D mode (A–L)",
    "board_state": "8×5 2D array, inactive cells = None, empty = null, occupied = piece_id"
}
```

**Piece definitions:** Identical to the front 2D mode (see §4.1 above). All 12 pieces (A–L) with the same binary matrices and orientation generation apply.

**Board representation:** A 5×8 (rows×cols) 2D array where each cell stores `None` (inactive/removed slot), `null` (active but empty), or a piece ID (`A`–`L`).

**Placement format:** `[piece_id, row, col, orientation_index]` — same as front 2D mode, but `row` (0–4) and `col` (0–7) reference the 8×5 back grid.

**Challenge database:** 40 dedicated challenges for this back mode (separate from the 40 front-side challenges). In the challenge booklet, these are labeled for the "bottom side" or "diagonal" grid. Encoded into PostgreSQL under `game_id = "IQ_PUZZLER_PRO_BACK_2D"` using the same schema as front 2D challenges (pre-placed pieces + full solution).

**CV pipeline changes required:**

- **Board detection:** The YOLO OBB model must detect and classify the back board as a distinct SKU variant (`IQ_PUZZLER_PRO_BACK_2D`) separate from the front board. Add synthetic STL renders of the back board for training data.
- **Homography:** After perspective warp, the rectified image maps to the 8×5 back grid instead of the 5×11 front grid.
- **Grid mapper:** Implement a `BackBoard2DGridMapper` that maps pixel positions to the 8×5 active-cell coordinates, with `None` for inactive slots.
- **Orientation templates:** Pre-render STL silhouettes of all 12 pieces on the back board grid (same pieces, different reference grid dimensions).

### 4.2 IQ Noodles

| Property | Value |
|----------|-------|
| **Board** | 7×7 checkerboard knob matrix (21 knob positions) |
| **Grid type** | Knob-and-edge graph |
| **Pieces** | 11 curved noodle pieces (A–K), double-sided |
| **Rotations** | 4 (0°, 90°, 180°, 270°) |
| **Flipping** | Yes (double-sided) |
| **Max orientations/piece** | 8 |
| **Piece types** | **Type A — Closed loops (9 pieces):** A, B, C, D, E, F, G, H, K — form a complete circuit around knobs. **Type B — Open-ended (2 pieces):** I, J — have two `E` endpoints each; open ends must connect to open ends of the other Type B piece. ⚠️ Classification confirmed visually from physical piece images; verify by tracing before encoding. |
| **Complexity** | ⭐⭐⭐ Medium |

**Board knob matrix** (1 = knob present, 0 = empty space):
```
0 0 1 0 1 0 0
0 1 0 1 0 1 0
1 0 1 0 1 0 1
0 1 0 1 0 1 0
1 0 1 0 1 0 1
0 1 0 1 0 1 0
0 0 1 0 1 0 0
```

**Key concept:** Pieces are curved tubes that wrap AROUND the knobs. Each piece:
- Sits **on top of** knobs (occupying knob positions) at loop/bend points
- Passes **between** adjacent knobs along edges (each knob connects to its ±1,±1 diagonal neighbors in the 7×7 grid — these are the nearest knobs in the checkerboard)
- At each knob, the path can go **straight**, turn **left 90°**, turn **right 90°**, or **end** (endpoint)

**Piece encoding:** Each piece is defined as a **turn sequence** from an arbitrary starting direction:
- `S` = straight through
- `L` = turn left 90°
- `R` = turn right 90°
- `E` = endpoint (open end)

Example: `"SLRSRL"` — a noodle that goes straight, turns left, turns right, goes straight, turns right, turns left.

**Piece definitions** (⚠️ turn sequences require verification against physical pieces before Sprint 3 encoding):

| ID | Color | Hex | Seq. Length | Type | Canonical Turn Sequence | Notes |
|----|-------|-----|-------------|------|------------------------|-------|
| A | YellowGreen | #95D450 | 4 | Closed loop | `RLLR` | ⚠️ TBD — verify from physical piece |
| B | Red | #EE394F | 5 | Closed loop | `RSLRS` | ⚠️ TBD |
| C | DarkBlue | #206DD9 | 5 | Closed loop | `RSLLR` | ⚠️ TBD |
| D | Purple | #C778B9 | 5 | Closed loop | `RRSLL` | ⚠️ TBD |
| E | Orange | #FC690C | 5 | Closed loop | `RLLRS` | ⚠️ TBD |
| F | SkyBlue | #08A7E8 | 5 | Closed loop | `RLSRL` | ⚠️ TBD |
| G | Green | #1FA15B | 6 | Closed loop | `RSLLRS` | ⚠️ TBD |
| H | DarkRed | #B63048 | 6 | Closed loop | `RSLRSL` | ⚠️ TBD |
| I | Yellow | #F9D65E | 6 | Open-ended | `ESLRSE` | ⚠️ TBD — has 2 endpoints; open-ended classification confirmed visually |
| J | Pink | #EC71A8 | 5 | Open-ended | `ESRLE` | ⚠️ TBD — has 2 endpoints; open-ended classification confirmed visually |
| K | Teal | #85DABB | 4 | Closed loop | `TBD` | ⚠️ TBD — distinct sequence required; do NOT copy from piece A |

> **Column note — "Seq. Length":** This is the **length of the turn sequence** (number of direction changes), NOT the number of unique knobs visited. The sum across all pieces (56) exceeds the 21 board knobs because these are placeholder sequences. When verified against physical pieces, the total unique knob visits across all 11 pieces must equal exactly **21** (every knob used exactly once in a complete solution).

> **Action required:** All turn sequences above are placeholder estimates. Each piece must be traced on the physical game board and its exact turn sequence recorded before challenge encoding begins.
> **Color verification (Sprint 0):** All colors above were corrected from physical spare-part images (SG 309-1 = A, SG 309-2 = B, ..., SG 309-11 = K). The previous charter colors were entirely wrong.
> **⚠️ Color disambiguation:** All 11 pieces now have distinct, well-separated colors (verified from physical color palette). No two pieces share visually similar shades. The CV pipeline can use both color and shape for reliable piece identification.

**Board state** — Dual representation:
1. `knobs[21]`: which piece (if any) passes through each knob
2. `edges[32]`: which piece (if any) occupies each edge (32 edges = all diagonal-adjacent knob pairs)

> **Edge count derivation (32):** Each knob connects to its ±1,±1 diagonal neighbors in the 7×7 grid. Counting by row-pair adjacencies: rows 0↔1: 4 edges, rows 1↔2: 6, rows 2↔3: 6, rows 3↔4: 6, rows 4↔5: 6, rows 5↔6: 4. Total = 4+6+6+6+6+4 = **32**.

**Placement format:** `[piece_id, row, col, orientation_index]`

> `orientation_index` (0–7) fully encodes rotation (0°/90°/180°/270°) and flip (front/back). The entry direction from the anchor knob is derived at runtime from the orientation index and the piece's turn sequence — it is not stored separately.

### 4.3 IQ Waves

| Property | Value |
|----------|-------|
| **Board** | 4 rows × 8 columns = 32 alternating H/V slots |
| **Grid type** | Interlocking slot grid |
| **Pieces** | 8 wave-shaped pieces, double-sided |
| **Rotations** | Yes (can be placed H or V) |
| **Flipping** | Yes (double-sided) |
| **Complexity** | ⭐⭐⭐⭐ Hard |

> **Verification note:** Total slots = A(4)+B(4)+C(4)+D(4)+E(4)+F(4)+G(6)+H(2) = **32 = 4×8 board** ✔️. Pieces G (Lime Green) and H (Cyan) are non-standard sizes (both priced at 2€ vs 1€ for A–F), confirming they occupy different slot counts. The 4×8 board footprint is confirmed from solved board images. Exact slot offsets for all pieces require physical measurement.

**Board slot grid** (H = horizontal slot, V = vertical slot):
```
H V H V H V H V
V H V H V H V H
H V H V H V H V
V H V H V H V H
```

**Key concept:** Each piece is a contiguous block of slots with a **wavy edge profile**. Pieces are concave and connect tip-to-tip with adjacent pieces. At each boundary, the wave profiles must be **complementary** (concave meets convex tip).

**Piece encoding:**
1. **Shape:** relative slot offsets the piece occupies (like a polyomino on the H/V grid)
2. **Profile:** for each shared boundary between slots, the edge type (concave/convex)
3. Each piece can be placed **horizontally or vertically** and **flipped** (front/back)

**Piece definitions** (⚠️ slot offsets and profiles require verification against physical pieces before Phase 2 encoding):

| ID | Color | Slots | Slot Offsets (row, col) | Profile Edges | Notes |
|----|-------|-------|------------------------|---------------|-------|
| A | Yellow | 4 | TBD — 4-arm windmill/propeller shape | TBD | ⚠️ Measure physically; non-square arrangement |
| B | Red | 4 | TBD | TBD | ⚠️ TBD |
| C | Dark Navy Blue | 4 | TBD | TBD | ⚠️ TBD |
| D | Orange | 4 | TBD | TBD | ⚠️ TBD |
| E | Purple | 4 | TBD | TBD | ⚠️ TBD |
| F | Hot Pink | 4 | TBD | TBD | ⚠️ TBD |
| G | Lime Green | 6 | TBD — larger windmill shape, wider footprint | TBD | ⚠️ Physically larger piece (2€ retail price); slot count estimated as 6 — verify |
| H | Cyan | 2 | `[(0,0),(0,1)]` — linear dumbbell/bone shape | TBD | ⚠️ Confirmed 2-lobe dumbbell from image; also priced 2€ — verify exact slot span |

> **⚠️ Non-standard piece sizes:** Piece G (Lime Green) is confirmed visually larger than other pieces and is estimated at 6 slots. Piece H (Cyan) is a 2-slot linear dumbbell. Both G and H are priced at 2€ (vs 1€ for A–F), confirming they are non-standard sizes. Exact slot offsets for all pieces require physical measurement.
>
> **⚠️ Color disambiguation:** Pieces B (Red) and E (Purple) may appear similar under warm indoor lighting. Shape matching takes priority over color for these two pieces.

> **Action required:** All slot offsets and profile edges above are placeholder estimates. Each piece must be physically measured and its exact slot occupancy and wave boundary profiles recorded. Profile edges define which boundaries are concave vs. convex — critical for the complementary-fit constraint.

**Board state:** A 4×8 2D array where each slot stores `null` or `(piece_id, side)`.

**Placement format:** `[piece_id, row, col, orientation_index, side]`

---

## 5. Objectives and Stakeholders

### 5.1 Ultimate Objective

Build a production-quality, web-first computer vision system that allows a phone camera to capture photos of a physical Smart NV puzzle, processes those images on a backend server, and displays real-time puzzle state, hints, and completion detection on a dashboard.

### 5.2 High-Level Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| P1 | **Photo Capture**: Mobile browser photo capture and upload (iOS Safari + Android Chrome) | Must |
| P2 | **Board Detection**: YOLO OBB/keypoint model detects board, identifies SKU, returns 4 corners | Must |
| P3 | **Piece Identification**: YOLO-seg model identifies pieces by type + color within rectified image | Must |
| P4 | **Placement Tracking**: Determine each piece's status (correct / incorrect / absent) | Must |
| P5 | **Puzzle Solving**: DLX solver (Algorithm X with Dancing Links) computes solution from any partial board state | Must |
| P6 | **State Sync**: Push processed state to dashboard via WebSocket (Redis PubSub) | Must |
| P7 | **Hint Generation**: Three-tier hints (area → piece → exact position) from solver output | Must |
| P8 | **Completion Detection**: Detect when all pieces are correctly placed, trigger celebration | Must |
| P9 | **Multi-Game Support**: Pipeline works for IQ Puzzler Pro, IQ Noodles, and IQ Waves | Should |

### 5.3 High-Level Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| End-to-end latency | ≤ 2s (P95, Wi-Fi), ≤ 3s (mobile data) |
| Piece detection accuracy | mAP@0.5 ≥ 0.90 |
| Board detection rate | ≥ 95% (up to 45° angle, 75cm) |
| Privacy (GDPR) | No photo storage by default; parental consent for any storage |
| Accessibility | WCAG 2.1 AA (48px touch targets, color-blind-friendly) |
| Scalability | Multi-session, K8s-deployable |

### 5.4 Stakeholders

| Stakeholder | Role | Business Value |
|-------------|------|----------------|
| Smart NV (client) | Product owner; provides puzzle assets, STL files, and business requirements | Commercially viable digital companion product |
| Children ages 8+ | Primary users of phone client | Step-by-step, age-appropriate hints for independent play |
| Parents/Teachers | Secondary users; manage phone and dashboard | Reduced burden of constant assistance; visibility into progress |
| Development Team | Designs, builds, and tests the system | Research-grade prototype demonstrating technical feasibility |
| Thomas More University | Academic supervisor | Evaluates technical quality, methodology, documentation |

---

## 6. The CV Pipeline (Enhanced)

```
[Phone] → Photo upload (REST)
    ↓
[YOLO OBB] → Detects rectangular board boundary
           → Identifies which game (SKU)
           → Returns 4 corner keypoints (ordered)
    ↓
[OpenCV Homography] → Perspective warp → clean top-down image
    ↓
[YOLO Segmentation] → Per piece: pixel mask + color class
    ↓
[STL Template Matcher] → Normalizes mask → IoU match against
                         pre-rendered silhouettes from STL files
                       → Resolves exact 2D orientation (pure OpenCV, <5ms)
    ↓
[Grid Mapper] → Pixel positions → logical board coordinates
               IQ Puzzler Pro (front): (row, col) 5×11 cell grid
               IQ Puzzler Pro (back):  (row, col) 8×5 cell grid (active cells only)
               IQ Noodles:             (knob_id) + edge connections
               IQ Waves:               (row, col) + H/V slot type
    ↓
[DLX Solver] → Algorithm X with Dancing Links
             → Treats placed pieces as constraints
             → Fills remaining empty cells with unplaced pieces
             → Returns complete valid solution (≤ 500ms)
    ↓
[Diff Engine] → Current state vs. solver solution
             → Identifies missing pieces + their target placements
    ↓
[Hint Engine] → Tier 1: area hint ("look at the top-left")
              → Tier 2: which piece ("you need the red piece")
              → Tier 3: exact cells highlighted
    ↓
[Redis PubSub] → WebSocket push to dashboard
    ↓
[React + Konva.js Dashboard] → Live board, hints, completion screen
```

### 6.1 What Is Trained vs. Hardcoded vs. Computed

| Component | Type | Source |
|-----------|------|--------|
| Board detection | Trained YOLO OBB | Synthetic STL renders |
| Piece segmentation + color | Trained YOLO-seg | Synthetic + real photos |
| Orientation templates | Hardcoded binary masks | STL files → OpenCV |
| Grid coordinate maps | Hardcoded per SKU | STL geometry |
| Puzzle solver | **Computed live** (Algorithm X / DLX) | Piece definitions + board geometry |
| Hint logic | Hardcoded diff engine | Solver output + game rules |

### 6.2 The DLX Solver

All three puzzle games are **exact cover problems**: every cell/knob/slot on the board must be occupied by exactly one piece. Algorithm X with Dancing Links (DLX) is purpose-built for this class of problem.

**How it works:**
1. **Formulate as exact cover:** Create a binary matrix where rows represent possible piece placements (piece + position + orientation) and columns represent constraints (each cell must be filled, each piece used once)
2. **Apply constraints from CV:** Pieces detected on the board are fixed — their columns and cells are removed from the matrix
3. **Run Algorithm X:** Recursively select rows that cover remaining columns, using Dancing Links for O(1) insert/remove operations
4. **Return first valid solution:** Complete assignment of all remaining pieces to remaining cells

**Performance characteristics:**
| Game | Board size | Pieces | Expected solve time |
|------|-----------|--------|--------------------|
| IQ Puzzler Pro (front) | 55 cells | 12 pieces | <100ms |
| IQ Puzzler Pro (back) | ~38 active cells | 12 pieces | <100ms |
| IQ Noodles | 21 knobs + 32 edges | 11 pieces | <500ms |
| IQ Waves | 32 slots | 8 pieces | <200ms |

> **Why DLX over other approaches?** DLX is the gold standard for polyomino/exact cover puzzles. It’s used by most online IQ Puzzler solvers. For our problem sizes (8–12 pieces, 32–55 cells), it finds solutions near-instantly. Unlike SAT solvers or ILP, DLX produces solutions that are directly interpretable as piece placements — no post-processing needed.

**Advantages over pre-encoded challenge DB:**
- Works for **any** board state, not just 320 booklet challenges
- No manual encoding effort (saves ~50+ person-hours)
- Children can play freestyle / create their own challenges
- No risk of encoding errors in the solution database

### 6.3 STL Synthetic Data Pipeline

The system generates synthetic training data and orientation templates from STL 3D model files. This is a critical pre-processing step that feeds both YOLO model training and runtime template matching.

**Inputs:** STL files for each game board and all pieces (provided by Smart NV).

**Pipeline steps:**

1. **Load STL meshes** — Using `trimesh` (Python). Each piece mesh is loaded and normalized to a canonical orientation.
2. **Generate all valid orientations** — For each piece, apply all rotation (0°/90°/180°/270°) and flip (front/back) transforms. Deduplicate identical resulting meshes.
3. **Render 2D silhouettes** — For each orientation, project the 3D mesh onto a 2D plane (top-down orthographic projection) at a fixed resolution matching the rectified board image. Output: binary mask (PNG) per piece × orientation.
4. **Compose synthetic board images** — Place random subsets of piece silhouettes onto the board template at valid positions. Apply augmentations:
   - **Geometric:** Random rotation (±5°), slight perspective skew, minor translation jitter
   - **Photometric:** Random brightness (±30%), contrast (±20%), Gaussian noise (σ=5–15), color temperature shift
   - **Occlusion:** Random rectangular patches (simulating children's hands) covering 0–15% of board area
5. **Export** — Synthetic images + YOLO-format annotation files (OBB for board corners, segmentation masks for pieces).

**Output volumes (target per game):**

| Output Type | Count | Purpose |
|-------------|-------|---------|
| Piece orientation templates | 12 × ~6 avg = ~72 (Puzzler Pro) | Runtime IoU template matching |
| Synthetic board images (OBB) | 500–1,000 | Board detection model training |
| Synthetic board images (Seg) | 500–1,000 | Piece segmentation model training |

**Tools:** `trimesh` for mesh loading, OpenCV for 2D projection + augmentation, NumPy for mask operations. No GPU required for rendering (orthographic projection is simple geometry).

**Real vs. synthetic data mix:** Target 60% synthetic + 40% real photos for training. Synthetic data provides pose diversity; real photos provide lighting/texture realism. The ratio is tuned per experiment.

---

## 7. Project Scope and Risk Analysis

### 7.1 In Scope

- Web-first phone client (React 18, TypeScript, Vite) for photo capture and upload
- FastAPI backend (Python 3.11) running OpenCV + Ultralytics YOLO26 CV pipeline
- Laptop dashboard (React + Konva.js) receiving live state via WebSocket
- Training two Ultralytics YOLO26 models (board detection OBB + piece segmentation)
- **Algorithm X (DLX) puzzle solver** for computing solutions from any partial board state
- **STL template pre-rendering** for orientation matching
- Hint generation engine with three tiers (driven by solver output)
- Completion detection with celebration animation
- Docker Compose (local) → k3s on AWS EC2 g4dn.xlarge (staging)
- GDPR-compliant in-memory photo processing
- **User selects game from menu** before scanning (IQ Puzzler Pro / IQ Noodles / IQ Waves)
- Support for **3 specific puzzle SKUs** (4 game modes): IQ Puzzler Pro (front 2D + back 2D), IQ Noodles, IQ Waves
- **IQ Puzzler Pro Back 2D Mode** — back/bottom face of the board with 8×5 diagonal grid

### 7.2 Out of Scope

- IQ Puzzler Pro 3D pyramid mode
- Real-time video streaming
- Native mobile app (React Native/Flutter) — Phase 3
- On-device ML inference (CoreML/TFLite) — validated as PoC only
- User accounts, progress tracking, admin panel — Phase 2
- Pre-encoded challenge database (replaced by live DLX solver)
- Multi-puzzle catalog beyond the 3 target SKUs
- AR overlays and social features

### 7.3 Client Responsibilities

- Provide physical game units for all 3 SKUs
- Provide STL files for all puzzle pieces and boards
- Provide challenge booklets for solver verification
- Timely feedback at each sprint demo (within 5 business days)
- Appoint internal project lead as single point of contact
- Recruit families with children aged 8+ for user testing

### 7.4 Risk Analysis

**Client-Side Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Delayed delivery of STL files or physical game units | High | Client appoints single POC; assets delivered before Sprint 1 |
| Insufficient families for user testing | Medium | Client begins recruitment by Week 4 |
| Changing scope mid-project | Medium | Scope changes formally logged and approved in writing |
| GDPR consent not obtained for child participants | High | Client prepares parental consent forms in advance |

**Team-Side Risks:**

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phone camera fragmentation (iOS/Android) | Medium | `input type="file" capture` as universal fallback |
| Board occlusion by children's hands | Medium | Training on diverse occlusion scenarios |
| ML model not generalising across puzzle variants | Medium | Per-SKU models in MVP; generalised architecture in V2 |
| Lighting variation in real homes | Medium | CLAHE pre-processing + diverse training augmentation |
| IQ Noodles curved piece detection harder than expected | High | Noodles deferred to Sprint 3; extra synthetic data budget |
| IQ Waves interlocking profiles hard to distinguish | High | Wave profile encoded manually; CV only detects shape, not profile |
| DLX solver performance on complex boards | Low | Algorithm X is well-proven for these problem sizes; benchmark during Sprint 0 |
| Front vs. back board misclassification by YOLO OBB | Medium | Train with explicit front/back label classes; 45° tilt of back mode provides distinctive visual feature |

---

## 8. Technology Stack

### 8.1 Frontend (Phone + Dashboard)

| Component | Technology |
|-----------|-----------|
| Framework | React 18 + TypeScript |
| Camera/Photo | `input type="file" capture` + `getUserMedia` |
| Upload | `fetch` multipart POST |
| WebSocket | Native API + `reconnecting-websocket` |
| Dashboard rendering | Konva.js via `react-konva` |
| State management | Zustand |
| UI components | Radix UI + Tailwind CSS |
| Build | Vite |

### 8.2 Backend

| Component | Technology |
|-----------|-----------|
| Language | Python 3.11 |
| Framework | FastAPI + Uvicorn |
| CV library | OpenCV 4.13 (`opencv-contrib-python`) |
| ML inference | ONNX Runtime |
| ML training | Ultralytics YOLO26 (ultralytics ≥ 8.3) |
| Session state | Redis 7 (live) |
| Persistent storage | PostgreSQL 16 (challenge DB + history) |
| ORM | SQLAlchemy 2.0 + Alembic |

### 8.3 Infrastructure

| Component | Technology |
|-----------|-----------|
| Local dev | Docker + Docker Compose |
| Staging | AWS EC2 g4dn.xlarge, K8s via k3s |
| Production (future) | AWS EKS + ALB |
| CDN | CloudFront |
| SSL | Let's Encrypt / AWS ACM |
| Monitoring | Prometheus + Grafana |

---

## 9. Research Experiments

| # | Experiment | Week | Key Metrics |
|---|-----------|------|-------------|
| 1 | Photo Capture & Upload Reliability | 1–2 | Capture success ≥ 99%, latency ≤ 2s |
| 2 | Board Detection Accuracy | 2–3 | Detection ≥ 95% at 45°/75cm, ≤ 50ms |
| 3 | ML Piece Detection | 3–6 | mAP@0.5 ≥ 0.90, recall ≥ 92%, ≤ 90ms CPU |
| 4 | End-to-End Latency (incl. solver) | 5–7 | P95 ≤ 2s (Wi-Fi), ≤ 3s (mobile), solver ≤ 500ms |
| 5 | UX Prototype & User Testing | 6–8 | Setup ≤ 60s, hint comprehension ≥ 70% |

---

## 10. Sprint Plan

### Sprint 0 — Discovery & Setup (Week 1)

- Stakeholder interview with Smart NV
- Setup: Git repo, Docker Compose, CI pipeline, project board
- **Encode IQ Puzzler Pro front challenges** (40) into PostgreSQL — cell grid format is straightforward
- **Encode IQ Puzzler Pro back challenges** (40) into PostgreSQL — same cell-grid format, 8×5 back grid
- **Physically map the 8×5 back grid binary matrix** and count exact active cells (Sprint 0 verification)
- **Pre-render STL templates** for IQ Puzzler Pro pieces (front + back board grids)
- Review STL files and challenge booklets for all 3 games
- Begin tracing IQ Noodles physical pieces to validate turn sequences
- Confirm GDPR consent approach

> **Note:** IQ Noodles challenge encoding (120 knob-path sequences) and IQ Waves challenge encoding (120 oriented slot sets) require significantly more effort than IQ Puzzler Pro's simple cell coordinates. These run **in parallel** with Sprint 1–2 development respectively, not in Sprint 0.

### Sprint 1 — Photo Capture & Board Detection (Weeks 2–4)

- Build React phone client (photo capture + upload)
- Build FastAPI backend: JPEG ingestion, YOLO OBB board detection, homography
- Generate synthetic board training data from STL files (see §6.3 STL Synthetic Data Pipeline)
- Train YOLO board detection model (front and back board face discrimination)
- **Target game: IQ Puzzler Pro (front 2D + back 2D)**
- **Parallel data work:** Encode IQ Noodles challenges (120) — knob-path sequences
- Demo: Phone photo → board detection → rectified image on dashboard

### Sprint 2 — Piece Detection & Challenge Matching (Weeks 4–6)

- Collect/annotate 1,000+ rectified board images
- Train YOLO-seg piece segmentation model
- Implement template matching (STL silhouettes → orientation resolution)
- Implement challenge matcher (fingerprint pre-placed pieces → match DB)
- Implement diff engine + 3-tier hint system
- **Target game: IQ Puzzler Pro**
- **Parallel data work:** Encode IQ Waves challenges (120) — oriented slot sets
- Demo: Phone photo → full CV pipeline → puzzle state + hints on dashboard

### Sprint 3 — UX, Multi-Game & User Testing (Weeks 6–8)

- Build full dashboard UX (Konva.js board canvas, hint display, completion screen)
- Implement completion detection with celebration animation
- **Add IQ Noodles**: train noodle piece model, implement knob-edge grid mapper
- Conduct user testing with 5–8 families
- Demo: Full live system demo with IQ Puzzler Pro + IQ Noodles

### Phase 2 — IQ Waves & Polish (Weeks 8–10)

- **Add IQ Waves**: train wave piece model, implement H/V slot grid mapper
- Harden MVP, deploy on K8s
- Complete documentation, final stakeholder presentation
- Handover package

---

## 11. Success Metrics

| Metric | Target | Method |
|--------|--------|--------|
| Setup Time | ≤ 60 seconds | User testing observation |
| Hint Comprehension Rate | ≥ 70% unaided | User testing task completion |
| Completion Detection Accuracy | ≥ 95% | System telemetry |
| End-to-End Latency | ≤ 2 seconds (P95) | Performance monitoring |
| Photo Capture Success Rate | ≥ 99% | System telemetry |
| Board Detection Rate | ≥ 95% (up to 45°) | Experimental validation |
| ML Piece Detection Accuracy | mAP@0.5 ≥ 0.90 | Model evaluation |
| Solver Performance | ≤ 500ms for all games | Benchmarking |
| User Satisfaction Score | ≥ 4.0/5.0 | Post-session survey |

---

## 12. GDPR Compliance

- **No Photo Storage by Default**: Images processed in-memory only
- **Optional Photo Storage**: S3 only with explicit parental consent
- **Data Retention**: Stored photos deleted after 90 days
- **Consent Management**: Written parental consent for user testing
- **HTTPS Only**: All communication encrypted via TLS 1.3
- **Session Security**: UUID v4 session IDs (cryptographically random)

---

## 13. Phased Roadmap

| Phase | Timeline | Focus |
|-------|----------|-------|
| **MVP (this project)** | Weeks 1–10 | 3 games, web-first, DLX solver, user selects puzzle then scans |
| **V2** | Months 4–7 | Multi-SKU, user accounts, dynamic hints, auto-training pipeline |
| **V3** | Months 8–12 | Native mobile app, on-device ML, AR overlays, social features |

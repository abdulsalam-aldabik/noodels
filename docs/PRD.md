# Product Requirements Document (PRD)

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 4, 2026 |
| **Owner** | Development Team |

---

## 1. Product Overview

### 1.1 Problem Statement

Children aged 8+ playing Smart NV logic puzzles (IQ Puzzler Pro, IQ Noodles, IQ Waves) get stuck on challenges and have no digital support. The only fallback is the printed solution booklet — requiring literacy — or asking an adult. This leads to frustration, disengagement, and game abandonment.

### 1.2 Product Vision

A phone-to-dashboard computer vision system where the child selects their puzzle, scans the board with a phone camera, and receives progressive hints computed by a live solver — all without touching the game or requiring the child to read.

### 1.3 Target Users

| User | Description | Primary Need |
|------|-------------|-------------|
| **Child (8+)** | Primary player solving the puzzle | Age-appropriate hints without reading |
| **Parent/Teacher** | Sets up the session, monitors from dashboard | Easy setup, visibility into progress |

---

## 2. Supported Games

### 2.1 IQ Puzzler Pro (Priority 1 — Sprint 1–2)

**The game:** 12 colored polyomino pieces fill a 5×11 grid of circular cells. Each challenge pre-places some pieces; the player fills the rest.

**Board model:**
- Grid: 5 rows × 11 columns = 55 cells
- Cell type: circular hole (each holds one ball)
- Coordinate system: `(row: 0–4, col: 0–10)`

**Pieces:** 12 pieces defined as binary matrices:

```json
[
  {"id": "A", "color": "pink",     "rgb": "#FF69B4", "shape": [[1,1,0,0],[0,1,1,1]]},
  {"id": "B", "color": "cyan",     "rgb": "#00CED1", "shape": [[1,1,1],[1,1,0]]},
  {"id": "C", "color": "orange",   "rgb": "#FF8C00", "shape": [[1,0,0],[1,1,1],[0,1,0]]},
  {"id": "D", "color": "purple",   "rgb": "#800080", "shape": [[1,1,0],[0,1,1],[0,0,1]]},
  {"id": "E", "color": "yellow",   "rgb": "#FFD700", "shape": [[1,1,1,1],[0,1,0,0]]},
  {"id": "F", "color": "cherry",   "rgb": "#DC143C", "shape": [[1,1,0],[0,1,1]]},
  {"id": "G", "color": "green",    "rgb": "#228B22", "shape": [[1,1,1],[0,1,0]]},
  {"id": "H", "color": "blue",     "rgb": "#0000CD", "shape": [[1,1,1],[1,0,0],[1,0,0]]},
  {"id": "I", "color": "red",      "rgb": "#FF0000", "shape": [[1,1,1,1],[1,0,0,0]]},
  {"id": "J", "color": "olive",    "rgb": "#6B8E23", "shape": [[1,1,1],[1,0,1]]},
  {"id": "K", "color": "darkBlue", "rgb": "#00008B", "shape": [[1,1,1],[1,0,0]]},
  {"id": "L", "color": "sky",      "rgb": "#87CEEB", "shape": [[1,1],[1,0]]}
]
```

**Orientation generation:** For each piece, generate all unique orientations via:
1. Rotate 90° (repeat 3×) → 4 rotations
2. Horizontal flip → repeat rotations → up to 4 more
3. Deduplicate identical shapes

**Placement:** Each piece placement is `(piece_id, row, col, orientation_index)`.

> `piece_id` (A–L) is the canonical identifier. Color is a secondary attribute used for display only.

**Board state:** 5×11 array; each cell is `null` or piece ID.

#### 2.1.1 IQ Puzzler Pro — Back Side 2D Mode (Diagonal 2D)

**The game:** The same 12 colored polyomino pieces fill the back/bottom face of the IQ Puzzler Pro board, which uses an 8×5 grid with inactive cells removed to form 3 interlocking diamond shapes. The board is held at 45° relative to the player.

**Mode ID:** `IQ_PUZZLER_PRO_BACK_2D`

**Board model:**
- Grid: 5 rows × 8 columns = 40 theoretical cells (inactive cells removed at corners/periphery)
- Cell type: circular hole (same as front)
- Coordinate system: `(row: 0–4, col: 0–7)`
- Active-cell mask: binary 8×5 matrix (⚠️ verify physically in Sprint 0)
- Orientation: board held at 45° relative to player

**Pieces:** Same 12 pieces (A–L) as front 2D mode with identical binary matrices and orientation generation.

**Orientation generation:** Identical to front 2D mode (see §2.1).

**Placement:** Each piece placement is `(piece_id, row, col, orientation_index)` — same format as front, but coordinates reference the 8×5 back grid.

**Board state:** 5×8 array; each cell is `None` (inactive), `null` (empty), or piece ID.

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

**Challenge database:** 40 dedicated challenges (separate from the 40 front-side challenges), labeled in the booklet for the "bottom side" / "diagonal" grid. Encoded under `game_id = "IQ_PUZZLER_PRO_BACK_2D"`.

### 2.2 IQ Noodles (Priority 2 — Sprint 3)

**The game:** 11 curved noodle pieces (A–K) wrap around knobs on a diamond-shaped board.

**Piece types:**
- **Closed loops (9 pieces):** form complete circuits around knobs, no endpoints
- **Open-ended (2 pieces):** have two endpoints each; open ends must connect to open ends of other open-ended pieces

**Board model:**
- Knob matrix: 7×7 checkerboard pattern = **21 knob positions**
- Edges between adjacent knobs: **32 edges** (diagonal neighbors in the checkerboard)
- Pieces wrap around knobs and occupy edges between adjacent knobs
- Movement: 4 diagonal directions in the 7×7 grid (NE, NW, SE, SW); each knob connects to its ±1,±1 nearest checkerboard neighbors

```
Knob positions (1 = knob):
0 0 1 0 1 0 0     row 0
0 1 0 1 0 1 0     row 1
1 0 1 0 1 0 1     row 2
0 1 0 1 0 1 0     row 3
1 0 1 0 1 0 1     row 4
0 1 0 1 0 1 0     row 5
0 0 1 0 1 0 0     row 6
```

**Pieces:** 11 noodle pieces encoded as turn sequences:
- `S` = straight through knob
- `L` = turn left 90°
- `R` = turn right 90°
- `E` = endpoint (piece ends here)

| Property | Value |
|----------|-------|
| Total pieces | 11 (A–K) |
| Closed-loop pieces | 9 (no endpoints) |
| Open-ended pieces | 2 (each has 2 endpoints) |
| Double-sided (flippable) | Yes, all pieces |
| Rotatable | 4 orientations × 2 flip states |

**Pieces** (⚠️ turn sequences are placeholders pending physical piece verification):

| ID | Color | Hex | Type | Turn Sequence |
|----|-------|-----|------|---------------|
| A | YellowGreen | #95D450 | Closed | `RLLR` |
| B | Red | #EE394F | Closed | `RSLRS` |
| C | DarkBlue | #206DD9 | Closed | `RSLLR` |
| D | Purple | #C778B9 | Closed | `RRSLL` |
| E | Orange | #FC690C | Closed | `RLLRS` |
| F | SkyBlue | #08A7E8 | Closed | `RLSRL` |
| G | Green | #1FA15B | Closed | `RSLLRS` |
| H | DarkRed | #B63048 | Closed | `RSLRSL` |
| I | Yellow | #F9D65E | Open | `ESLRSE` |
| J | Pink | #EC71A8 | Open | `ESRLE` |
| K | Teal | #85DABB | Closed | `TBD` |

**Board state — dual representation:**
1. `knobs{}`: maps each of 21 knob coordinates to piece ID (or null)
2. `edges{}`: maps each of 32 edges (pair of adjacent knobs) to piece ID (or null)

**Placement:** `(piece_id, row, col, orientation_index)`

> `orientation_index` (0–7) encodes rotation + flip. Entry direction from anchor knob is derived at runtime.

### 2.3 IQ Waves (Priority 3 — Phase 2)

**The game:** 8 wave-shaped pieces fill a 4×8 alternating H/V slot grid. Pieces have wavy edges that must interlock with adjacent pieces.

**Board model:**
- Grid: 4 rows × 8 columns = **32 slots**
- Slot types alternate: H (horizontal) and V (vertical)
- Board math: A(4)+B(4)+C(4)+D(4)+E(4)+F(4)+G(6)+H(2) = **32** ✓

```
Slot type pattern:
H V H V H V H V     row 0
V H V H V H V H     row 1
H V H V H V H V     row 2
V H V H V H V H     row 3
```

**Pieces:** 8 pieces of varying sizes and shapes (⚠️ slot offsets are placeholders pending physical verification):

| ID | Color | Slots | Notes |
|----|-------|-------|-------|
| A | Yellow | 4 | ⚠️ TBD — 4-arm windmill/propeller shape |
| B | Red | 4 | ⚠️ TBD |
| C | Dark Navy Blue | 4 | ⚠️ TBD |
| D | Orange | 4 | ⚠️ TBD |
| E | Purple | 4 | ⚠️ TBD |
| F | Hot Pink | 4 | ⚠️ TBD |
| G | Lime Green | 6 | ⚠️ Physically larger piece (2€ retail price); slot count estimated as 6 — verify |
| H | Cyan | 2 | ⚠️ Confirmed 2-lobe dumbbell from image; also priced 2€ — verify exact slot span |

> **⚠️ Non-standard piece sizes:** Piece G (Lime Green) is estimated at 6 slots. Piece H (Cyan) is a 2-slot linear dumbbell. Both G and H are priced at 2€ (vs 1€ for A–F), confirming non-standard sizes.
>
> **⚠️ Color disambiguation:** Pieces B (Red) and E (Purple) may appear similar under warm indoor lighting. Shape matching takes priority over color for these two pieces.

Each piece:
- Occupies a contiguous group of slots on the grid
- Has a wavy edge profile (concave/convex pattern)
- Is double-sided (can be flipped front/back)
- Can potentially be rotated (H ↔ V, but must match the board's H/V pattern)

**Wave profile constraint:** Adjacent pieces must have complementary profiles at shared boundaries (concave meets convex tip).

**Board state:** 4×8 array; each slot is `null` or `(piece_id, side)`.

**Placement:** `(piece_id, row, col, orientation_index, side)`

---

## 3. Feature Requirements

### 3.1 Photo Capture (P1)

| Requirement | Details |
|-------------|---------|
| Platform | Mobile browser (iOS Safari, Android Chrome) |
| Method | `input type="file" capture="environment"` (primary); `getUserMedia` (secondary) |
| Upload | Multipart POST to `/api/v1/sessions/{id}/photos` |
| Image format | JPEG, ≤ 5MB, minimum 1280×720 |
| Feedback | Capture confirmation with thumbnail preview |

### 3.2 Board Detection (P2)

| Requirement | Details |
|-------------|---------|
| Model | Ultralytics YOLO26-N OBB / Keypoint |
| Output | 4 ordered corner points + SKU class (which game + board face) |
| Accuracy | ≥ 95% detection at up to 45° angle, 75cm distance |
| Latency | ≤ 50ms per frame |
| Post-processing | Homography warp → rectified top-down image |

### 3.3 Piece Segmentation (P3)

| Requirement | Details |
|-------------|---------|
| Model | Ultralytics YOLO26-N Segmentation |
| Output | Per-piece: pixel mask + color class + bounding box |
| Accuracy | mAP@0.5 ≥ 0.90, per-piece recall ≥ 92% |
| Latency | ≤ 90ms CPU / ≤ 5ms GPU |
| Post-processing | STL template IoU matching → orientation + piece ID |

### 3.4 Puzzle Solver (P5)

| Requirement | Details |
|-------------|--------|
| Algorithm | Algorithm X with Dancing Links (DLX) — exact cover solver |
| Input | Game type (user-selected) + detected board state (placed pieces from CV) |
| Output | Complete valid solution (all remaining pieces placed) |
| Solve speed | ≤ 500ms for IQ Puzzler Pro, ≤ 2s for IQ Noodles/Waves |
| Partial board | Solver treats detected pieces as constraints and fills the rest |
| No challenge DB | Solutions are computed live — no pre-encoded challenge database needed |

### 3.5 Hint Engine (P7)

| Tier | User Sees | Implementation |
|------|-----------|----------------|
| **Tier 1: Area** | "Look at the top-left area" | Identify region of board with most missing pieces (from solver output) |
| **Tier 2: Piece** | "You need the red piece" | Diff between current state and solver solution identifies which piece to place next |
| **Tier 3: Exact** | Highlighted cells on board visualization | Show exact cells from solver solution where the next piece belongs |

Hints are **progressive**: Tier 1 on first request, Tier 2 on second, Tier 3 on third. Timer resets per piece.

> **Solver-driven hints:** Because the solver computes the solution live from any board state, hints work for any arrangement of pieces — not just pre-defined challenges. A child can place pieces freely and still receive help.

### 3.6 Dashboard (P6, P8)

| Component | Details |
|-----------|---------|
| Live board canvas | Konva.js rendering of grid with piece states (grey/green/red) |
| Piece status panel | Shows all pieces with placed/unplaced/misplaced indicators |
| Hint display | Overlay on board canvas or side panel |
| Completion screen | Confetti animation, elapsed time, accuracy score |
| Session info | Current challenge, difficulty level, game name |

### 3.7 Completion Detection (P8)

| Requirement | Details |
|-------------|---------|
| Trigger | All cells/knobs/slots are occupied AND placement matches a valid solution (solver confirms) |
| Accuracy | ≥ 95% (no false positives) |
| Celebration | Confetti animation + sound + score display |
| Score | Based on: time elapsed, hints used, number of photo submissions |

---

## 4. Data Model

### 4.1 Solver Input Schema

```json
{
  "game_id": "iq_puzzler_pro",
  "placed_pieces": [
    {"piece_id": "A", "row": 0, "col": 0, "orientation": 6},
    {"piece_id": "E", "row": 1, "col": 0, "orientation": 1}
  ]
}
```

### 4.2 Solver Output Schema

```json
{
  "solved": true,
  "solution": [
    {"piece_id": "I", "row": 0, "col": 9, "orientation": 4},
    {"piece_id": "J", "row": 1, "col": 7, "orientation": 0},
    {"piece_id": "D", "row": 2, "col": 8, "orientation": 3}
  ],
  "solve_time_ms": 42
}
```

### 4.3 Session Schema

```json
{
  "session_id": "uuid-v4",
  "game_id": "iq_puzzler_pro",
  "board_state": [
    [null, null, "A", "A", null, null, null, null, null, null, null],
    ["E", "E", "E", "E", null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null]
  ],
  "solver_solution": null,
  "hints_used": 2,
  "photos_submitted": 5,
  "started_at": "2026-03-03T10:00:00Z",
  "status": "in_progress"
}
```

---

## 5. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/sessions` | Create new session (user selects game) |
| `POST` | `/api/v1/sessions/{id}/photos` | Upload photo for processing |
| `GET` | `/api/v1/sessions/{id}/state` | Get current board state + solver solution |
| `POST` | `/api/v1/sessions/{id}/hint` | Request next hint tier |
| `POST` | `/api/v1/sessions/{id}/solve` | Trigger solver on current board state |
| `WS` | `/ws/sessions/{id}` | WebSocket for live state updates |
| `GET` | `/api/v1/games` | List supported games |
| `GET` | `/api/v1/games/{id}/pieces` | Get piece definitions for a game |

---

## 6. Acceptance Criteria

### 6.1 MVP Definition of Done

- [ ] User selects game from menu, photographs board, and sees recognized state on dashboard
- [ ] Solver computes a valid solution for any partial board state within 2s
- [ ] Board detection discriminates between front and back board faces
- [ ] Three-tier hints work correctly against solver-computed solutions
- [ ] Completion detection triggers celebration with ≥ 95% accuracy
- [ ] End-to-end latency ≤ 2s (P95) on Wi-Fi
- [ ] IQ Noodles board detection and piece recognition working (Sprint 3+)
- [ ] IQ Waves board detection and piece recognition working (Phase 2)
- [ ] DLX solver works for all 3 games (Puzzler Pro, Noodles, Waves)
- [ ] 5–8 families tested, satisfaction ≥ 4.0/5.0

### 6.2 Per-Sprint Acceptance

| Sprint | Must Demonstrate |
|--------|-----------------|
| Sprint 1 | Phone photo → board detected → rectified image on dashboard |
| Sprint 2 | Phone photo → pieces identified → solver computes solution → hints displayed |
| Sprint 3 | Full UX with IQ Puzzler Pro + IQ Noodles; user testing complete |
| Phase 2 | IQ Waves added; hardened MVP deployed on K8s |

# System Architecture

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 16, 2026 |

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE PHONE                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Client App (React + Vite)                               │   │
│  │  ┌────────────┐  ┌────────────────┐  ┌───────────────┐  │   │
│  │  │ Camera      │  │ On-Device ML   │  │ Payload       │  │   │
│  │  │ Capture     │→ │ YOLO26 Nano    │→ │ Transmit      │  │   │
│  │  │             │  │ (Inference)    │  │ (Grid State)  │  │   │
│  │  └────────────┘  └────────────────┘  └───────┬───────┘  │   │
│  └──────────────────────────────────────────────┼───────────┘   │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │ HTTPS POST
                                                  │ (lightweight JSON payload)
                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│             BACKEND SERVER (Company Internal Infrastructure)    │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ /api/v1/     │  │ DLX Solver   │  │ Session Manager     │   │
│  │ sessions/    │→ │ (Algorithm X │→ │ (State + Hints)     │   │
│  │ solve        │  │  Backtrack)  │  │                     │   │
│  └──────────────┘  └──────────────┘  └─────────────────────┘   │
│                                                                 │
│  ┌───────────────┐                                              │
│  │ PostgreSQL    │                                              │
│  │ (sessions,    │                                              │
│  │  games,       │                                              │
│  │  pieces)      │                                              │
│  └───────────────┘                                              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ HTTP GET (dashboard polls / fetches state)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD (Laptop/Secondary Device)           │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React + Vite Dashboard                                   │   │
│  │  ┌────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │ Board       │  │ Hint         │  │ Session          │  │   │
│  │  │ Display     │  │ Display      │  │ Progress         │  │   │
│  │  └────────────┘  └──────────────┘  └──────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Frontend — Phone Client (React + Vite)

```
src/
├── App.tsx                 # Router: / → game selector, /capture → camera
├── components/
│   ├── camera/
│   │   ├── CaptureButton.tsx      # <input type="file" capture="environment">
│   │   └── PhotoPreview.tsx       # Thumbnail + re-take
│   ├── common/
│   │   └── GameSelector.tsx       # IQ Puzzler Pro | Noodles | Waves
│   └── ml/
│       └── OnDeviceInference.tsx  # YOLO26 nano on-device processing
├── services/
│   ├── api.ts              # HTTP client for backend endpoints
│   └── inference.ts        # YOLO26 nano model loading + inference
└── types/
    ├── game.ts             # Game, Piece types
    └── session.ts          # Session, BoardState types
```

### 2.2 Frontend — Dashboard (React + Vite)

```
src/
├── App.tsx                 # Dashboard view for session tracking
├── components/
│   ├── dashboard/
│   │   ├── BoardDisplay.tsx       # Visual board state
│   │   ├── HintDisplay.tsx        # Hint rendering
│   │   └── ProgressTracker.tsx    # Session progress over time
│   └── common/
│       └── SessionInfo.tsx        # Game name, session ID
├── services/
│   └── api.ts              # HTTP client to fetch session state
└── types/
    └── session.ts          # Session, BoardState, Hint types
```

### 2.3 Backend (FastAPI — Company Internal Infrastructure)

```
app/
├── main.py                 # FastAPI app, lifespan, middleware
├── api/
│   ├── routes/
│   │   ├── sessions.py     # Create session, submit grid state, get state
│   │   ├── games.py        # Game/piece listing
│   │   └── hints.py        # Hint request endpoint
│   └── deps.py             # Dependency injection
├── core/
│   ├── config.py           # Settings via pydantic-settings
│   └── database.py         # SQLAlchemy engine + session
├── solver/
│   ├── dlx.py              # Dancing Links (Algorithm X) core implementation
│   ├── base.py             # Abstract PuzzleSolver interface
│   ├── puzzler_pro.py      # IQ Puzzler Pro exact cover formulation (front + back)
│   ├── noodles.py           # IQ Noodles exact cover formulation
│   └── waves.py            # IQ Waves exact cover formulation (H/V slot grid)
├── engine/
│   ├── diff.py             # Compare current_state vs solver solution
│   └── hints.py            # Hint generation from solver output
├── models/
│   ├── game.py             # SQLAlchemy: Game, Piece
│   └── session.py          # SQLAlchemy: Session
└── schemas/
    ├── game.py             # Pydantic response models
    └── session.py          # Pydantic request/response models
```

---

## 3. Data Flow

### 3.1 On-Device Processing + Backend Solve Pipeline

```
User selects game from menu (IQ Puzzler Pro / Noodles / Waves)
       │
       ▼
User takes photo of board
       │
       ▼
┌─────────────────────────┐
│ 1. On-Device YOLO26     │  YOLO26 nano processes image locally on phone
│    Nano Inference       │  Handles bounding, normalization, segmentation
│    (on phone)           │  Output: detected piece positions on grid
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 2. Payload Construction │  Phone constructs lightweight JSON payload:
│    (on phone)           │  {game_id, grid_state: [(piece_id, row, col)...]}
└──────────┬──────────────┘
           │ HTTPS POST (JSON, not photos)
           ▼
┌─────────────────────────┐
│ 3. DLX Solver           │  Algorithm X / Backtracking fills remaining
│    (backend server)     │  empty cells with unplaced pieces
│    (≤ 1.5s)             │  Output: complete_solution
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 4. Diff Engine          │  current_state XOR solver_solution →
│    (backend server)     │  missing pieces + their placements
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 5. Hint Generation      │  Generate hints from solver output
│    (backend server)     │  Return hints to phone + update session
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 6. Session Update       │  Write updated state to PostgreSQL
│    (backend server)     │  Dashboard can fetch latest state
└─────────────────────────┘
```

### 3.2 Dashboard Sync Protocol

The dashboard (secondary device) accesses the same session via HTTP:

```
Dashboard loads session:  GET /api/v1/sessions/{session_id}
Dashboard polls updates:  GET /api/v1/sessions/{session_id}/state

Response:
{
  "session_id": "uuid",
  "game_id": "iq_puzzler_pro",
  "board_state": [["A","A",null,...], ...],
  "pieces": {
    "A": {"status": "correct", "cells": [[0,1],[0,2]]},
    "B": {"status": "missing", "cells": []}
  },
  "solver_solution": {"solved": true, "solve_time_ms": 42},
  "hints": [...],
  "photos_submitted": 3,
  "completion": false
}
```

---

## 4. Database Schema

### 4.1 Entity Relationship

```
┌──────────┐       ┌──────────────┐
│  games   │ 1───N │   pieces     │
│──────────│       │──────────────│
│ id (PK)  │       │ id (PK)      │
│ name     │       │ game_id (FK) │
│ grid_type│       │ label        │
│ rows     │       │ color        │
│ cols     │       │ rgb_hex      │
│ meta     │       │ base_shape   │
└──────────┘       │ orientations │
                   └──────────────┘

                   ┌──────────────┐
                   │  sessions    │
                   │──────────────│
                   │ id (PK/UUID) │
                   │ game_id (FK) │
                   │ board_state  │
                   │ solver_sol   │
                   │ hints_used   │
                   │ status       │
                   │ started_at   │
                   │ completed_at │
                   └──────────────┘
```

### 4.2 Table Definitions

```sql
-- Games table
CREATE TABLE games (
    id          VARCHAR(30) PRIMARY KEY,  -- 'iq_puzzler_pro', 'iq_puzzler_pro_back_2d', 'iq_noodles', 'iq_waves'
    name        VARCHAR(50) NOT NULL,
    grid_type   VARCHAR(20) NOT NULL,     -- 'cell', 'knob_edge', 'hv_slot'
    rows        INTEGER NOT NULL,
    cols        INTEGER NOT NULL,
    meta        JSONB DEFAULT '{}'        -- game-specific config (e.g. active_cell_mask for back board)
);

-- Pieces table
CREATE TABLE pieces (
    id          SERIAL PRIMARY KEY,
    game_id     VARCHAR(30) REFERENCES games(id),
    label       CHAR(1) NOT NULL,         -- 'A'..'L'
    color       VARCHAR(20) NOT NULL,
    rgb_hex     CHAR(7) NOT NULL,         -- '#FF69B4'
    base_shape  JSONB NOT NULL,           -- binary matrix or turn sequence
    orientations JSONB NOT NULL,          -- pre-computed array of all unique orientations
    UNIQUE(game_id, label)
);

-- Sessions table
CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         VARCHAR(30) REFERENCES games(id),
    board_state     JSONB NOT NULL DEFAULT '[]',
    solver_solution JSONB,                -- last solver output (cached)
    hints_used      INTEGER NOT NULL DEFAULT 0,
    photos_submitted INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);
```

### 4.3 Solver Integration

The DLX solver computes solutions on-the-fly from any partial board state:

```python
async def solve_board(game_id: str, board_state: list, pieces: list) -> dict:
    """
    Given a partial board state (from on-device CV), use Algorithm X
    with Dancing Links / backtracking to find a valid placement for
    all remaining pieces.

    1. Identify which cells are empty and which pieces are unplaced
    2. Formulate as exact cover problem
    3. Run DLX solver
    4. Return complete solution or indicate unsolvable
    """
    solver = get_solver(game_id)  # PuzzlerProSolver, NoodlesSolver, or WavesSolver
    placed = extract_placed_pieces(board_state)
    solution = solver.solve(board_state, placed_pieces=placed)
    return {"solved": solution is not None, "placements": solution}
```

---

## 5. On-Device CV Pipeline

### 5.1 Processing Flow

1. **User selects puzzle** from the app menu.
2. **User snaps a handheld top-down photo** directly on their phone.
3. **On-Device Phone ML (YOLO26 nano)**: The phone processes the image locally, handling bounding, normalization, and segment masking natively.
4. **Payload Construction**: A lightweight JSON payload of structured physical layout positions is constructed on the phone.
5. **Data Transmission**: The JSON grid-state payload (not the photo) is sent to the backend server.
6. **DLX / Backtracking Resolver**: Backend processes piece connectivity and derives hints.
7. **Session Update**: New state is persisted; dashboard can fetch the latest.

### 5.2 Data Generation & Model Refinement

- **Real data**: Taken and labelled on Roboflow for fine-tuning the model to handle authentic ambient lighting conditions.
- **Synthetic data**: Base synthetic datasets generated from scaled 3D STL files, combined with real data to ensure model robustness.

### 5.3 STL Synthetic Data Pipeline

**Inputs:** STL files for each game board and all pieces (provided by Smart NV).

**Pipeline steps:**

1. **Load STL meshes** — Using `trimesh` (Python). Each piece mesh is loaded and normalized.
2. **Generate all valid orientations** — For each piece, apply rotation and flip transforms. Deduplicate identical resulting meshes.
3. **Render 2D silhouettes** — Top-down orthographic projection at fixed resolution. Output: binary mask (PNG) per piece × orientation.
4. **Compose synthetic board images** — Place random subsets of piece silhouettes onto the board template at valid positions. Apply augmentations:
   - **Geometric:** Rotation, perspective skew, translation jitter
   - **Photometric:** Brightness, contrast, noise, color temperature shift
5. **Export** — Synthetic images + annotation files for YOLO training.

**Real vs. synthetic data mix:** Target 60% synthetic + 40% real photos for training. Synthetic data provides pose diversity; real photos provide lighting/texture realism.

**Tools:** `trimesh` for mesh loading, OpenCV for 2D projection + augmentation, NumPy for mask operations.

---

## 6. Hint Engine Architecture

```python
class HintEngine:
    """Progressive hint system powered by DLX solver output."""

    def get_hint(self, session: Session) -> Hint:
        solution = session.solver_solution
        diff = self.diff_engine.compute(session.board_state, solution)

        tier = session.hints_used % 3 + 1  # cycle: 1 → 2 → 3 → 1...

        if tier == 1:
            return self._area_hint(diff)
        elif tier == 2:
            return self._piece_hint(diff)
        else:
            return self._exact_hint(diff)

    def _area_hint(self, diff: DiffResult) -> Hint:
        """Identify the board region with most missing pieces."""
        region = self._densest_missing_region(diff.missing_cells)
        return Hint(tier=1, message=f"Look at the {region} area")

    def _piece_hint(self, diff: DiffResult) -> Hint:
        """Identify one specific missing piece."""
        piece = diff.missing_pieces[0]
        return Hint(tier=2, piece_id=piece.id,
                    message=f"Try the {piece.color} piece")

    def _exact_hint(self, diff: DiffResult) -> Hint:
        """Show exact placement cells for one missing piece."""
        piece = diff.missing_pieces[0]
        cells = diff.solution_cells[piece.id]
        return Hint(tier=3, piece_id=piece.id,
                    highlight_cells=cells,
                    message=f"Place {piece.color} piece here")
```

---

## 7. Game-Specific Grid Mappers

> Note: Grid mapping now happens on the phone (on-device), not on the server. These data structures define how each game's board is represented in the payload sent to the solver.

### 7.1 IQ Puzzler Pro — Cell Grid (Front)

- **Grid:** 5 rows × 11 columns = 55 cells
- **Payload:** 2D array where each cell is `null` (empty) or piece ID (`A`–`L`)
- **Back 2D mode:** Custom matrix of 55 cells with active-cell mask

### 7.2 IQ Noodles — Grid Graph with Intersections

- **Grid:** Graph with intersections
- **Pieces:** 11 curved noodle pieces spanning orthogonal intersections
- **Encoding:** CURVE, CROSS_NS, CROSS_EW segments
- **Payload:** Detected piece positions as intersection coordinates

### 7.3 IQ Waves — H/V Slot Grid

- **Grid:** 4 rows × 8 columns = 32 alternating H/V slots
- **Payload:** 2D array where each slot is `null` or `(piece_id)`

---

## 8. Security & Privacy

| Layer | Measure |
|-------|---------|
| **Data Retention** | 0-day — photos processed only in local memory on phone, never transmitted |
| **Data Transmission** | Only lightweight JSON grid-state payloads sent to server (no photos) |
| **Transport** | HTTPS for all API communication |
| **CORS** | Allow-list: frontend origin only |
| **Sessions** | Anonymous UUID, no authentication required (children's app) |
| **Privacy** | No PII collected; no photos stored; no GDPR consent needed |
| **Input Validation** | Pydantic strict mode on all backend endpoints |
| **Infrastructure** | Deployed on company's internal infrastructure (no AWS) |

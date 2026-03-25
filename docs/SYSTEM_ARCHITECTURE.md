# System Architecture

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 4, 2026 |

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MOBILE PHONE                             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  React PWA (Vite)                                        │   │
│  │  ┌────────────┐  ┌─────────────┐  ┌──────────────────┐  │   │
│  │  │ Camera      │  │ Upload      │  │ WebSocket        │  │   │
│  │  │ Capture     │→ │ Service     │  │ Listener         │  │   │
│  │  └────────────┘  └──────┬──────┘  └────────┬─────────┘  │   │
│  └──────────────────────────┼─────────────────┼─────────────┘   │
└─────────────────────────────┼─────────────────┼─────────────────┘
                              │ HTTPS POST      │ WSS
                              ▼                 │
┌─────────────────────────────────────────────────────────────────┐
│                      FASTAPI SERVER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │ /api/v1/     │  │ CV Pipeline  │  │ WebSocket Manager   │   │
│  │ sessions/    │→ │ Orchestrator │→ │ (Redis PubSub)      │──→│ WSS
│  │ {id}/photos  │  │              │  │                     │   │
│  └──────────────┘  └──────┬───────┘  └─────────────────────┘   │
│                           │                                     │
│  ┌────────┬───────────────┼───────────────┬──────────────┐      │
│  │        ▼               ▼               ▼              │      │
│  │ ┌────────────┐ ┌──────────────┐ ┌──────────────┐     │      │
│  │ Board      │ │ Piece        │ │ DLX Solver   │     │      │
│  │ Detector   │ │ Segmentor    │ │ (Algorithm X)│     │      │
│  │ (YOLO OBB) │ │ (YOLO Seg)   │ │              │     │      │
│  └─────┖──────┘ └──────┖───────┘ └──────┖───────┘     │      │
│  │       │               │                │              │      │
│  │       ▼               ▼                ▼              │      │
│  │ ┌────────────┐ ┌──────────────┐ ┌──────────────┐     │      │
│  │ │ Homography │ │ STL Template │ │ Diff Engine  │     │      │
│  │ │ Warp       │ │ Matcher      │ │              │     │      │
│  │ │ (OpenCV)   │ │ (trimesh)    │ │              │     │      │
│  │ └─────┬──────┘ └──────┬───────┘ └──────┬───────┘     │      │
│  │       │               │                │              │      │
│  │       └───────────────┼────────────────┘              │      │
│  │                       ▼                               │      │
│  │              ┌─────────────────┐                      │      │
│  │              │ Grid Mapper     │                      │      │
│  │              │ (game-specific) │                      │      │
│  │              └────────┬────────┘                      │      │
│  │                       ▼                               │      │
│  │              ┌─────────────────┐                      │      ││  │              │ DLX Solver      │                      │      │
│  │              │ (Algorithm X)   │                      │      │
│  │              └────────┖────────┘                      │      │
│  │                       ▼                               │      │
│  │              ┌─────────────────┐                      │      ││  │              │ Hint Engine     │                      │      │
│  │              │ (3 tiers)       │                      │      │
│  │              └─────────────────┘                      │      │
│  └───────────────────────────────────────────────────────┘      │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐                           │
│  │ PostgreSQL    │  │ Redis         │                           │
│  │ (games,       │  │ (sessions,    │                           │
│  │  pieces)      │  │  pub/sub)     │                           │
│  └───────────────┘  └───────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Frontend (React PWA)

```
src/
├── App.tsx                 # Router: / → capture, /dashboard → board view
├── components/
│   ├── camera/
│   │   ├── CaptureButton.tsx      # <input type="file" capture="environment">
│   │   └── PhotoPreview.tsx       # Thumbnail + re-take
│   ├── dashboard/
│   │   ├── BoardCanvas.tsx        # Konva.js grid renderer
│   │   ├── PieceStatusPanel.tsx   # Placed/unplaced/misplaced list
│   │   ├── HintDisplay.tsx        # Tier 1/2/3 hint rendering
│   │   └── CompletionOverlay.tsx  # Confetti + score
│   └── common/
│   └─── GameSelector.tsx       # IQ Puzzler Pro | Noodles | Waves (user selects before scanning)
│       └─── SessionInfo.tsx        # Game name, timer
├── hooks/
│   ├── useSession.ts       # Zustand store: session state
│   ├── useWebSocket.ts     # WS connection + reconnect logic
│   └── useBoardState.ts    # Board grid derived state
├── services/
│   ├── api.ts              # Axios instance + endpoints
│   └── ws.ts               # WebSocket connect/disconnect
├── types/
│   ├── game.ts             # Game, Piece, Challenge types
│   └── session.ts          # Session, BoardState, Hint types
└── utils/
    ├── gridRenderers/
    │   ├── puzzlerPro.ts   # 5×11 cell grid → Konva shapes (front)
    │   ├── puzzlerProBack.ts # 8×5 cell grid with active-cell mask → Konva shapes (back)
    │   ├── noodles.ts      # Knob-edge graph → Konva shapes
    │   └── waves.ts        # 4×8 H/V slot grid → Konva shapes
    └── colors.ts           # Piece color map
```

### 2.2 Backend (FastAPI)

```
app/
├── main.py                 # FastAPI app, lifespan, middleware
├── api/
│   ├── routes/
│   │   ├── sessions.py     # CRUD + photo upload
│   │   ├── games.py        # Game/piece/challenge listing
│   │   └── hints.py        # Hint request endpoint
│   └── websocket.py        # WS handler + Redis subscribe
├── core/
│   ├── config.py           # Settings via pydantic-settings
│   ├── database.py         # Async SQLAlchemy engine + session
│   └── redis.py            # Redis connection pool
├── cv/
│   ├── pipeline.py         # Orchestrator: photo → board_state
│   ├── board_detector.py   # YOLO OBB inference
│   ├── homography.py       # 4-point warp (OpenCV)
│   ├── piece_segmentor.py  # YOLO Seg inference
│   ├── template_matcher.py # STL silhouette IoU matching
│   └── grid_mappers/
│       ├── base.py         # Abstract GridMapper
│       ├── puzzler_pro.py  # Mask → 5×11 cell grid (front)
│       ├── puzzler_pro_back.py # Mask → 8×5 cell grid with active-cell mask (back)
│       ├── noodles.py      # Mask → knob-edge graph
│       └── waves.py        # Mask → 4×8 H/V slot grid
├── solver/
│   ├── dlx.py              # Dancing Links (Algorithm X) core implementation
│   ├── base.py             # Abstract PuzzleSolver interface
│   ├── puzzler_pro.py      # IQ Puzzler Pro exact cover formulation (front + back)
│   ├── noodles.py          # IQ Noodles exact cover formulation (knob-edge graph)
│   └── waves.py            # IQ Waves exact cover formulation (H/V slot grid)
├── engine/
│   ├── diff.py             # Compare current_state vs solver solution
│   └── hints.py            # Tier 1/2/3 hint generation
├── models/
│   ├── game.py             # SQLAlchemy: Game, Piece
│   └── session.py          # SQLAlchemy: Session
└── schemas/
    ├── game.py             # Pydantic response models
    ├── session.py          # Pydantic request/response models
    └── cv.py               # Pipeline I/O schemas
```

---

## 3. Data Flow

### 3.1 Photo Processing Pipeline

```
User selects game from menu
       │
       ▼
User takes photo of board
       │
       ▼
POST /api/v1/sessions/{id}/photos
       │
       ▼
┌─────────────────────┐
│ 1. Board Detection   │  YOLO OBB → 4 corners + game_class
│    (≤ 50ms)          │  Output: corners[], game_class
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 2. Homography Warp   │  cv2.getPerspectiveTransform → warp
│    (≤ 5ms)           │  Output: rectified 512×256 image
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 3. Piece Segmentation │  YOLO Seg → N masks + color classes
│    (≤ 90ms CPU)       │  Output: [(mask, color, bbox), ...]
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 4. STL Template Match │  For each mask: IoU vs pre-rendered
│    (≤ 30ms)           │  piece silhouettes → piece_id + orient
│                       │  Output: [(piece_id, orientation), ...]
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 5. Grid Mapping       │  Game-specific: mask pixel coords →
│    (≤ 10ms)           │  board coordinates
│                       │  Output: board_state (grid array)
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 6. DLX Solver         │  Algorithm X (Dancing Links) fills
│    (≤ 500ms)          │  remaining empty cells with unplaced pieces
│                       │  Output: complete_solution
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 7. Diff Engine        │  current_state XOR solver_solution →
│    (≤ 1ms)            │  missing pieces + their placements
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ 8. State Publish      │  Write to Redis + PUBLISH channel
│                       │  → WebSocket → React dashboard
└─────────────────────┘

Total target: ≤ 200ms (CPU) / ≤ 50ms (GPU)
```

### 3.2 WebSocket Protocol

**Connection:** `wss://host/ws/sessions/{session_id}`

**Server → Client messages:**

```json
{
  "type": "board_state",
  "data": {
    "board": [[null,"A","A",null,...], ...],
    "pieces": {
      "A": {"status": "correct", "cells": [[0,1],[0,2]]},
      "B": {"status": "misplaced", "cells": [[1,0],[1,1],[1,2]]},
      "I": {"status": "missing", "cells": []}
    },
    "solver_solution": {"solved": true, "solve_time_ms": 42},
    "completion": false
  }
}
```

```json
{
  "type": "hint",
  "data": {
    "tier": 2,
    "piece_id": "I",
    "message": "Try the red piece",
    "highlight_cells": null
  }
}
```

```json
{
  "type": "completion",
  "data": {
    "elapsed_seconds": 342,
    "hints_used": 2,
    "photos_submitted": 8,
    "score": 87
  }
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

-- Sessions table (ephemeral — can also live purely in Redis)
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
    \"\"\"
    Given a partial board state (from CV pipeline), use Algorithm X
    with Dancing Links to find a valid placement for all remaining pieces.
    
    1. Identify which cells are empty and which pieces are unplaced
    2. Formulate as exact cover: each empty cell and each unplaced piece
       must be covered exactly once
    3. Run DLX solver
    4. Return complete solution or indicate unsolvable
    \"\"\"
    solver = get_solver(game_id)  # PuzzlerProSolver, NoodlesSolver, or WavesSolver
    placed = extract_placed_pieces(board_state)
    solution = solver.solve(board_state, placed_pieces=placed)
    return {\"solved\": solution is not None, \"placements\": solution}
```

---

## 5. Game-Specific Grid Mappers

### 5.1 IQ Puzzler Pro — Cell Grid Mapper (Front)

```python
class PuzzlerProMapper(BaseGridMapper):
    """Maps YOLO segmentation masks to a 5×11 cell grid (front board)."""
    
    ROWS, COLS = 5, 11
    
    def mask_to_grid(self, mask: np.ndarray, piece_id: str) -> list[tuple[int,int]]:
        """
        Given a binary mask on the rectified image, return list of
        (row, col) cells that this piece occupies.
        
        1. Compute cell centers from known grid geometry
        2. For each cell center, check if mask[cy, cx] == 1
        3. Return occupied cells
        """
        cells = []
        for r in range(self.ROWS):
            for c in range(self.COLS):
                cx, cy = self.cell_center(r, c)
                if mask[cy, cx]:
                    cells.append((r, c))
        return cells
```

### 5.1.1 IQ Puzzler Pro — Back Board 2D Grid Mapper

```python
class BackBoard2DGridMapper(BaseGridMapper):
    """Maps YOLO segmentation masks to the 8×5 back board grid with active-cell mask."""
    
    ROWS, COLS = 5, 8
    ORIENTATION_ANGLE = 45  # board held at 45° relative to player
    
    # Active cell mask: 1 = active, 0 = inactive/removed
    # ⚠️ Placeholder — verify against physical board in Sprint 0
    ACTIVE_MASK = [
        [0, 1, 1, 1, 1, 1, 1, 0],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1],
        [0, 1, 1, 1, 1, 1, 1, 0],
    ]
    
    def is_active(self, row: int, col: int) -> bool:
        """Check if a cell is an active (playable) slot."""
        return bool(self.ACTIVE_MASK[row][col])
    
    def mask_to_grid(self, mask: np.ndarray, piece_id: str) -> list[tuple[int,int]]:
        """
        Given a binary mask on the rectified back-board image, return list of
        (row, col) active cells that this piece occupies.
        
        1. Compute cell centers from known 8×5 grid geometry
        2. For each active cell center, check if mask[cy, cx] == 1
        3. Skip inactive cells (return None for those positions)
        4. Return occupied active cells
        """
        cells = []
        for r in range(self.ROWS):
            for c in range(self.COLS):
                if not self.is_active(r, c):
                    continue
                cx, cy = self.cell_center(r, c)
                if mask[cy, cx]:
                    cells.append((r, c))
        return cells
```

### 5.2 IQ Noodles — Knob-Edge Graph Mapper

```python
class NoodlesMapper(BaseGridMapper):
    """Maps YOLO segmentation masks to a knob-edge graph."""
    
    KNOB_POSITIONS = [
        (0,2),(0,4),                         # row 0: 2 knobs
        (1,1),(1,3),(1,5),                   # row 1: 3 knobs  
        (2,0),(2,2),(2,4),(2,6),             # row 2: 4 knobs
        (3,1),(3,3),(3,5),                   # row 3: 3 knobs
        (4,0),(4,2),(4,4),(4,6),             # row 4: 4 knobs
        (5,1),(5,3),(5,5),                   # row 5: 3 knobs
        (6,2),(6,4),                         # row 6: 2 knobs
    ]  # 21 total
    
    def mask_to_graph(self, mask: np.ndarray, piece_id: str):
        """
        1. Check mask at each knob pixel position → occupied knobs
        2. For each pair of adjacent occupied knobs, mark edge
        3. Return {knobs: [...], edges: [...]}
        """
        occupied_knobs = []
        for knob in self.KNOB_POSITIONS:
            px, py = self.knob_pixel(knob)
            if mask[py, px]:
                occupied_knobs.append(knob)
        
        edges = []
        for k1 in occupied_knobs:
            for k2 in occupied_knobs:
                if self.are_adjacent(k1, k2) and (k2, k1) not in edges:
                    edges.append((k1, k2))
        
        return {"knobs": occupied_knobs, "edges": edges}
```

### 5.3 IQ Waves — H/V Slot Grid Mapper

```python
class WavesMapper(BaseGridMapper):
    """Maps YOLO segmentation masks to a 4×8 H/V slot grid."""
    
    ROWS, COLS = 4, 8
    
    def slot_type(self, row: int, col: int) -> str:
        """Returns 'H' or 'V' based on position."""
        return 'H' if (row + col) % 2 == 0 else 'V'
    
    def mask_to_grid(self, mask: np.ndarray, piece_id: str):
        """
        1. Compute slot centers from grid geometry
        2. For each slot center, check mask occupancy
        3. Return list of (row, col, slot_type)
        """
        slots = []
        for r in range(self.ROWS):
            for c in range(self.COLS):
                cx, cy = self.slot_center(r, c)
                if mask[cy, cx]:
                    slots.append((r, c, self.slot_type(r, c)))
        return slots
```

---

## 6. Hint Engine Architecture

```python
class HintEngine:
    """Progressive 3-tier hint system powered by DLX solver output."""
    
    def get_hint(self, session: Session) -> Hint:
        tier = session.hints_used % 3 + 1  # cycle: 1 → 2 → 3 → 1...
        # Solver solution is cached on the session after each photo
        solution = session.solver_solution
        diff = self.diff_engine.compute(session.board_state, solution)
        
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

## 7. Redis State Management

### 7.1 Key Schema

```
session:{uuid}:state    → JSON board_state (TTL: 2h)
session:{uuid}:meta     → JSON {game_id, hints_used, solver_solution} (TTL: 2h)
channel:session:{uuid}  → PubSub channel for live updates
```

### 7.2 Publish Flow

```python
async def publish_state(session_id: str, state: BoardState):
    """Write state to Redis and notify WebSocket subscribers."""
    key = f"session:{session_id}:state"
    channel = f"channel:session:{session_id}"
    
    pipe = redis.pipeline()
    pipe.set(key, state.model_dump_json(), ex=7200)
    pipe.publish(channel, state.model_dump_json())
    await pipe.execute()
```

### 7.3 WebSocket Handler

```python
@app.websocket("/ws/sessions/{session_id}")
async def ws_handler(ws: WebSocket, session_id: str):
    await ws.accept()
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"channel:session:{session_id}")
    
    try:
        # Send current state immediately
        current = await redis.get(f"session:{session_id}:state")
        if current:
            await ws.send_text(current)
        
        # Stream updates
        async for message in pubsub.listen():
            if message["type"] == "message":
                await ws.send_text(message["data"])
    finally:
        await pubsub.unsubscribe()
        await ws.close()
```

---

## 8. CV Model Training Pipeline

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 1. Capture    │────→│ 2. Annotate   │────→│ 3. Augment   │
│ 600-1200 imgs │     │ (Roboflow)    │     │ Flip, rotate │
│ 3 games       │     │ OBB + Seg     │     │ brightness   │
└──────────────┘     └──────────────┘     │ noise, crop  │
                                          └──────┬───────┘
                                                 │
                     ┌──────────────┐     ┌──────┴───────┐
                     │ 5. Export     │←────│ 4. Train     │
                     │ ONNX + torchscript│ │ YOLO26-N     │
                     │ → models/    │     │ 100 epochs   │
                     └──────────────┘     └──────────────┘
```

**Two models per game:**
1. **Board Detector** (YOLO OBB) — single class per game, outputs oriented bbox
2. **Piece Segmentor** (YOLO Seg) — N classes per game (one per piece color)

**Or unified approach:**
1. **Single Board Detector** — 4 classes: `puzzler_pro_front`, `puzzler_pro_back`, `noodles`, `waves`
2. **Game-specific Segmentors** — separate model per game for piece masks

---

## 9. Deployment Architecture (Phase 2)

```
                   ┌─────────────┐
                   │  NGINX      │
                   │  Ingress    │
                   │  (TLS+WS)  │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ API Pod  │ │ API Pod  │ │ API Pod  │
        │ (FastAPI)│ │ (FastAPI)│ │ (FastAPI)│
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             └─────────────┼─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼                         ▼
        ┌──────────┐           ┌──────────┐
        │ Redis    │           │ PostgreSQL│
        │ (HA)     │           │ (Primary) │
        └──────────┘           └──────────┘
```

**Scaling strategy:**
- API pods scale horizontally (stateless; state in Redis)
- Redis handles session state + pub/sub
- PostgreSQL handles persistent data (games, pieces)
- CV inference can be offloaded to GPU nodes if needed

---

## 10. Security Architecture

| Layer | Measure |
|-------|---------|
| Transport | TLS 1.3 via NGINX Ingress |
| CORS | Allow-list: frontend origin only |
| Rate limiting | 10 photos/min per session (FastAPI middleware) |
| Input validation | Pydantic strict mode on all endpoints |
| Image handling | Max 5MB, JPEG only, no server-side storage after processing |
| Sessions | Anonymous UUID, no authentication required (children's app) |
| GDPR | No PII collected; photos processed in-memory and discarded |
| WebSocket | Origin check on upgrade handshake |

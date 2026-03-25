# agents.md — AI Context & Coding Rules

## Smart NV Computer Vision Puzzle Tracking System

> This file provides AI coding assistants (Copilot, Cursor, etc.) with project context, conventions, and constraints. Keep it updated as the project evolves.

---

## 1. Project Summary

**What:** A computer vision system that watches children solve Smart NV physical puzzles (IQ Puzzler Pro, IQ Noodles, IQ Waves) via phone camera and provides progressive hints on a web dashboard.

**How:** User selects game → Phone photo → YOLO OBB (board detection) → Homography → YOLO Seg (piece segmentation) → STL Template Match → Grid Mapper → **DLX Solver** (Algorithm X with Dancing Links) → Diff Engine → Hint Engine → WebSocket → React Dashboard.

**Key insight:** The system uses a **live DLX solver** (Algorithm X with Dancing Links) to compute solutions from any partial board state. No pre-encoded challenge database. The user selects their puzzle, scans the board, and the solver fills in the rest.

---

## 2. Repository Structure

```
project/
├── docs/                      # Project documentation (you are here)
│   ├── PROJECT_CHARTER.md
│   ├── PRD.md
│   ├── TECH_STACK.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PROGRESS_LOG.md
│   └── agents.md             # This file
├── frontend/                  # React 18 + TypeScript + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
├── backend/                   # FastAPI + Python 3.11
│   ├── app/
│   │   ├── api/              # Routes + WebSocket
│   │   ├── cv/               # Computer vision pipeline
│   │   ├── solver/           # DLX solver (Algorithm X with Dancing Links)
│   │   ├── engine/           # Diff + Hint engines
│   │   ├── models/           # SQLAlchemy models
│   │   └── schemas/          # Pydantic schemas
│   └── pyproject.toml
├── models/                    # YOLO model weights + STL templates
│   ├── board_detector/
│   ├── piece_segmentor/
│   └── templates/            # Pre-rendered piece silhouettes
├── data/                      # Piece definitions
│   └── pieces/               # pieces.json per game
├── docker-compose.yml
└── .github/workflows/
```

---

## 3. Game Data Models

### 3.1 IQ Puzzler Pro (Front 2D)

- **Grid:** 5 rows × 11 columns = 55 cells
- **Pieces:** 12 (A–L), defined as binary matrices
- **Orientations:** Up to 8 per piece (4 rotations × 2 flips, deduplicated)
- **Board state:** `string[5][11]` — each cell is `null` or piece ID
- **Placement:** `{piece_id, row, col, orientation_index}`
- **Challenges:** 40 front-side challenges

> **Important:** `piece_id` (A–L) is the canonical identifier. Never use color as a primary key.

### 3.1.1 IQ Puzzler Pro (Back 2D / Diagonal 2D)

- **Mode ID:** `IQ_PUZZLER_PRO_BACK_2D`
- **Grid:** 5 rows × 8 columns = 40 theoretical cells (inactive cells removed at corners/periphery)
- **Active-cell mask:** Binary 8×5 matrix (⚠️ verify physically in Sprint 0)
- **Pieces:** Same 12 (A–L) as front 2D mode
- **Orientations:** Same as front 2D
- **Orientation angle:** 45° — board held at 45° relative to player
- **Board state:** `string[5][8]` — each cell is `None` (inactive), `null` (empty), or piece ID
- **Placement:** `{piece_id, row, col, orientation_index}` (coords reference 8×5 back grid)
- **Challenges:** 40 back-side challenges (separate from front)
- **Grid mapper:** `BackBoard2DGridMapper` — maps pixel positions to active cells only

### 3.2 IQ Noodles

- **Grid:** 7×7 checkerboard = 21 knobs + 32 edges between adjacent knobs
- **Pieces:** 11 (A–K), encoded as turn sequences (S/L/R/E)
- **Topology:** Knob-edge graph, NOT a cell grid
- **Board state:** `{knobs: {coord: piece_id}, edges: {(k1,k2): piece_id}}`
- **Movement:** 4 diagonal directions (NE, NW, SE, SW) in the 7×7 grid; knobs connect to ±1,±1 neighbors
- **Piece types:** 9 closed loops (A–H, K) + 2 open-ended (I, J — each has 2 endpoints)
- **Placement:** `{piece_id, row, col, orientation_index}` — entry direction derived from orientation at runtime

### 3.3 IQ Waves

- **Grid:** 4 rows × 8 columns = 32 slots, alternating H (horizontal) and V (vertical)
- **Pieces:** 8 total: 6 standard (4 slots each) + G (6 slots, larger) + H (2 slots, dumbbell); wavy edge profiles
- **Constraint:** Adjacent pieces must have complementary wave profiles (concave meets convex)
- **Board state:** `string[4][8]` — each slot is `null` or `(piece_id, side)`

---

## 4. Coding Conventions

### 4.1 Python (Backend)

```python
# Style: black + ruff (line length 88)
# Type hints: required on all public functions
# Async: use async/await for all I/O (FastAPI, SQLAlchemy, Redis)
# Naming: snake_case for functions/variables, PascalCase for classes

# Example:
async def detect_board(image: np.ndarray) -> BoardDetection:
    """Run YOLO OBB on input image and return board corners."""
    results = await model.predict(image)
    return BoardDetection(corners=results.obb.xyxyxyxy[0])

# Pydantic models for all API schemas
class BoardState(BaseModel):
    game_id: str
    grid: list[list[str | None]]
    pieces: dict[str, PieceStatus]

# Tests: pytest + pytest-asyncio
# File naming: test_{module}.py
```

### 4.2 TypeScript (Frontend)

```typescript
// Style: prettier (printWidth 100, singleQuote true)
// Components: functional + hooks, no class components
// State: Zustand stores in hooks/ directory
// Naming: PascalCase for components, camelCase for functions/variables

// Example:
interface PieceStatus {
  pieceId: string;
  status: 'correct' | 'misplaced' | 'missing';
  cells: [number, number][];
}

// Konva components for board rendering
const BoardCanvas: React.FC<{ boardState: BoardState }> = ({ boardState }) => {
  return (
    <Stage width={800} height={400}>
      <Layer>
        {/* Grid cells */}
      </Layer>
    </Stage>
  );
};
```

### 4.3 General Rules

- **No magic numbers.** Use named constants: `PUZZLER_PRO_ROWS = 5`
- **Solver is Algorithm X with Dancing Links (DLX).** All puzzles are exact cover problems. Solver computes solutions live from any partial board state.
- **Game-specific logic must be pluggable.** Use `BaseGridMapper` → `PuzzlerProMapper`, `NoodlesMapper`, `WavesMapper`. Same pattern for solvers: `BaseSolver` → `PuzzlerProSolver`, `NoodlesSolver`, `WavesSolver`.
- **Images are ephemeral.** Never persist uploaded photos to disk/S3.
- **Sessions are anonymous.** No authentication, no PII, no user accounts.
- **User selects game before scanning.** No automatic game detection — the user picks from a menu.
- **Binary matrices are the source of truth** for piece shapes (IQ Puzzler Pro).
- **Turn sequences are the source of truth** for piece shapes (IQ Noodles).

---

## 5. CV Pipeline Rules

1. **Board detection always runs first.** If no board detected, abort pipeline and return error.
2. **Homography warp produces a fixed-size output** (e.g., 512×256 for Puzzler Pro). All downstream processing works on this rectified image.
3. **Piece segmentation outputs per-piece binary masks.** Color classification is a byproduct of the seg model, not a separate step.
4. **STL template matching** compares YOLO seg masks against pre-rendered silhouettes. IoU threshold ≥ 0.75 for a match.
5. **Grid mapping is game-specific.** Each game has its own mapper class.
6. **DLX solver runs after grid mapping.** Takes the detected board state + unplaced pieces, returns a complete solution via Algorithm X (exact cover). Cached in Redis per session.
7. **Diff engine compares current state vs solver output.** `solver_solution_pieces - detected_pieces = pieces_still_to_place`.

---

## 6. Database Rules

- **Game IDs:** `iq_puzzler_pro`, `iq_puzzler_pro_back_2d`, `iq_noodles`, `iq_waves` (snake_case, ≤ 30 chars)
- **Piece labels:** Single uppercase letter (A–L for Puzzler Pro, A–K for Noodles, A–H for Waves)
- **No challenges table.** Solutions are computed live by the DLX solver.
- **JSONB columns** for: `base_shape`, `orientations`
- **Sessions** store the latest `solver_solution` (cached from last solve)

---

## 7. API Rules

- All endpoints under `/api/v1/`
- Use Pydantic models for request/response validation
- Return proper HTTP status codes (201 for creation, 404 for not found, 422 for validation error)
- WebSocket at `/ws/sessions/{session_id}`
- Session IDs are UUIDv4
- Photos accepted as multipart/form-data, JPEG only, ≤ 5MB

---

## 8. Testing Rules

- Backend: `pytest` with `pytest-asyncio` for async tests
- Frontend: `vitest` for unit tests, `playwright` for E2E
- CV pipeline: test with fixture images that have known expected outputs
- Challenge matcher: test with all challenges per game (40 for Puzzler Pro front, 40 for back, 120 for Noodles, 120 for Waves)
- Minimum coverage: 80% for new code

---

## 9. Key Constraints

| Constraint | Detail |
|-----------|--------|
| No solver | All solutions are pre-encoded. Never write backtracking code. |
| No 3D mode | IQ Puzzler Pro 3D pyramid mode is out of scope (40 pyramid challenges excluded) |
| No persistent images | Photos are processed in-memory and discarded |
| No auth | Sessions are anonymous UUIDs |
| Children's app | All UI must be usable without reading (icons, colors, visual hints) |
| 3 games only | IQ Puzzler Pro, IQ Noodles, IQ Waves — no other games |
| Latency target | ≤ 2s end-to-end (P95) on Wi-Fi |
| GDPR compliant | No PII collected or stored |

---

## 10. Common Pitfalls

- **Don't use `piece_color` as a database key or identifier.** Always use `piece_id` (A–L). Color is a secondary YOLO attribute; lighting makes similar colors ambiguous.
- **Don't confuse cell grids with knob-edge graphs.** Puzzler Pro uses cells; Noodles uses knobs+edges. They are fundamentally different data structures.
- **Don't assume all pieces have 8 orientations.** Some are symmetric and have fewer unique orientations (e.g., piece L has only 4).
- **Don't use color alone for piece identification.** Multiple lighting conditions → unreliable. Use shape (STL template match) as primary, color as secondary.
- **Don't store board state only in PostgreSQL.** Use Redis for live session state (fast reads); Postgres for challenges/pieces (persistent).
- **Don't forget the H/V alternation in Waves.** Slots alternate between horizontal and vertical — a piece can't just go anywhere.
- **Don't assume fingerprints are always unique.** Starter challenges with 1–2 pre-placed pieces may match multiple challenges. Implement a fallback shortlist or multi-pass confirmation.
- **Don't store `entry_direction` separately from `orientation_index` for Noodles.** Entry direction is derivable from orientation index + turn sequence. Storing both creates a consistency bug risk.
- **Don't encode all 320 challenges in Sprint 0.** Only Puzzler Pro (cell grid, 80 total) is fast to encode. Noodles (knob paths) and Waves (slot sets) take weeks — they run in parallel with Sprint 1–2.

---

## 11. Reference Materials

| Resource | Location |
|----------|----------|
| Project Charter | `docs/PROJECT_CHARTER.md` |
| PRD | `docs/PRD.md` |
| Tech Stack | `docs/TECH_STACK.md` |
| System Architecture | `docs/SYSTEM_ARCHITECTURE.md` |
| Implementation Plan | `docs/IMPLEMENTATION_PLAN.md` |
| Progress Log | `docs/PROGRESS_LOG.md` |
| IQ Puzzler Pro pieces (reference) | `data/pieces/puzzler_pro.json` |
| STL files | `*.stl` in project root |
| Challenge booklets | `*.pdf` in project root |
| Game photos | `image.png`, `image 2.png`, `image 3.png` |

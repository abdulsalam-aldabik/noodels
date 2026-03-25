# agents.md — AI Context & Coding Rules

## Smart NV Computer Vision Puzzle Tracking System

> This file provides AI coding assistants (Copilot, Cursor, etc.) with project context, conventions, and constraints. Keep it updated as the project evolves.

---

## 1. Project Summary

**What:** A computer vision system that helps children solve Smart NV physical puzzles (IQ Puzzler Pro, IQ Noodles, IQ Waves). The child selects their puzzle, snaps a photo, and the phone's on-device ML detects the board state. A lightweight payload is sent to the backend solver, which returns hints displayed on the phone and a secondary dashboard.

**How:** User selects game → Phone photo → **On-device YOLO26 nano** (bounding, normalization, segmentation on phone) → Lightweight JSON grid-state payload → Backend **DLX Solver** (Algorithm X / backtracking) → Diff Engine → Hint Engine → Response to phone + Dashboard update.

**Key insights:**
- **On-device inference**: YOLO26 nano runs entirely on the user's phone. No photos are transmitted to the server.
- **Live DLX solver**: Algorithm X with Dancing Links computes solutions from any partial board state. No pre-encoded challenge database.
- **0-day retention**: Photos are processed only in phone memory and immediately discarded.

---

## 2. Repository Structure

```
project/
├── docs/                      # Project documentation (you are here)
│   ├── PROJECT_CHARTER.md     # Authoritative charter (v2)
│   ├── PROJECT_CHARTER_v2.md  # Same as above (original v2 file)
│   ├── PRD.md
│   ├── TECH_STACK.md
│   ├── SYSTEM_ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── PROGRESS_LOG.md
│   └── agents.md             # This file
├── frontend/                  # React + Vite (phone client + dashboard)
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── ml/               # On-device YOLO26 nano integration
│   └── package.json
├── backend/                   # FastAPI + Python 3.11 (company internal infra)
│   ├── app/
│   │   ├── api/              # Routes (sessions, games, hints)
│   │   ├── solver/           # DLX solver (Algorithm X / backtracking)
│   │   ├── engine/           # Diff + Hint engines
│   │   ├── models/           # SQLAlchemy models (games, pieces, sessions)
│   │   └── schemas/          # Pydantic schemas
│   └── pyproject.toml
├── models/                    # YOLO model weights
│   └── yolo26_nano/          # On-device model files
├── data/                      # Piece definitions + STL files for training
│   ├── pieces/               # pieces.json per game
│   └── stl/                  # STL files for synthetic data generation
└── training/                  # Training scripts + synthetic data pipeline
    └── synthetic/            # STL → synthetic board images (trimesh + OpenCV)
```

---

## 3. Game Data Models

### 3.1 IQ Puzzler Pro (Front 2D + Back 2D) — Member 1

- **Grid:** Front: 5 rows × 11 columns = 55 cells; Back: custom active-cell mask
- **Pieces:** 12 (A–L), defined as binary matrices
- **Orientations:** Up to 8 per piece (4 rotations × 2 flips, deduplicated)
- **Board state:** `string[5][11]` — each cell is `null` or piece ID
- **Placement:** `{piece_id, row, col, orientation_index}`

> **Important:** `piece_id` (A–L) is the canonical identifier. Never use color as a primary key.

### 3.2 IQ Noodles — Member 2

- **Grid:** Grid graph with intersections
- **Pieces:** 11 curved noodle pieces (IDs 0–10)
- **Encoding:** `CURVE`, `CROSS_NS` (North-South Cross), `CROSS_EW` (East-West Cross) — derived from Java source reference
- **Topology:** Pieces span across orthogonal intersections; no diagonal movement
- **Placement:** Intersection-based coordinates

### 3.3 IQ Waves — Member 3

- **Grid:** 4 rows × 8 columns = 32 slots, alternating H (horizontal) and V (vertical)
- **Pieces:** 8 wave-shaped pieces
- **Board state:** `string[4][8]` — each slot is `null` or `piece_id`

---

## 4. Coding Conventions

### 4.1 Python (Backend)

```python
# Style: black + ruff (line length 88)
# Type hints: required on all public functions
# Async: use async/await for all I/O (FastAPI, SQLAlchemy)
# Naming: snake_case for functions/variables, PascalCase for classes

# Example:
async def solve_board(game_id: str, board_state: list) -> dict:
    """Run DLX solver on partial board state and return solution."""
    solver = get_solver(game_id)
    return solver.solve(board_state)

# Pydantic models for all API schemas
class GridStatePayload(BaseModel):
    game_id: str
    grid: list[list[str | None]]

# Tests: pytest + pytest-asyncio
# File naming: test_{module}.py
```

### 4.2 TypeScript (Frontend)

```typescript
// Style: prettier (printWidth 100, singleQuote true)
// Components: functional + hooks, no class components
// Naming: PascalCase for components, camelCase for functions/variables

// Example:
interface GridStatePayload {
  gameId: string;
  grid: (string | null)[][];
}
```

### 4.3 General Rules

- **No magic numbers.** Use named constants: `PUZZLER_PRO_ROWS = 5`
- **Solver is Algorithm X with Dancing Links (DLX) / backtracking.** All puzzles are exact cover problems.
- **Game-specific logic must be pluggable.** Use `BaseSolver` → `PuzzlerProSolver`, `NoodlesSolver`, `WavesSolver`.
- **Photos never leave the phone.** On-device YOLO26 nano processes locally; only JSON payloads sent to server.
- **Sessions are anonymous.** No authentication, no PII, no user accounts.
- **User selects game before scanning.** No automatic game detection.
- **Binary matrices are the source of truth** for piece shapes (IQ Puzzler Pro).
- **CURVE/CROSS_NS/CROSS_EW encoding** is the source of truth for IQ Noodles pieces (from Java source).

---

## 5. On-Device CV Pipeline Rules

1. **All inference runs on the phone.** YOLO26 nano processes the image natively on-device.
2. **No photos are transmitted.** Only lightweight JSON grid-state payloads are sent to the backend.
3. **Phone handles**: bounding, normalization, and segment masking.
4. **Backend handles**: DLX solving, diff computation, hint generation.
5. **Grid mapping is game-specific.** Each game has its own grid structure for the payload.
6. **DLX solver runs on the backend.** Takes detected board state + unplaced pieces, returns a complete solution.

---

## 6. Database Rules

- **Game IDs:** `iq_puzzler_pro`, `iq_puzzler_pro_back_2d`, `iq_noodles`, `iq_waves` (snake_case, ≤ 30 chars)
- **Piece labels:** Single uppercase letter (A–L for Puzzler Pro, A–K for Noodles, A–H for Waves)
- **No challenges table.** Solutions are computed live by the DLX solver.
- **JSONB columns** for: `base_shape`, `orientations`
- **Sessions** store the latest `solver_solution` (cached from last solve) and are accessible from dashboard
- **PostgreSQL** for persistent storage of games, pieces, and sessions

---

## 7. API Rules

- All endpoints under `/api/v1/`
- Use Pydantic models for request/response validation
- Return proper HTTP status codes (201 for creation, 404 for not found, 422 for validation error)
- Session IDs are UUIDv4
- **No photo uploads** — only JSON grid-state payloads
- Dashboard fetches session state via HTTP GET

---

## 8. Testing Rules

- Backend: `pytest` with `pytest-asyncio` for async tests
- Frontend: `vitest` for unit tests
- Solver: test with known board configurations for each game
- Minimum coverage: 80% for new code

---

## 9. Key Constraints

| Constraint | Detail |
|-----------|--------|
| On-device inference | YOLO26 nano runs on the phone; no server-side CV |
| No photos transmitted | Only lightweight JSON grid-state payloads sent to server |
| No 3D mode | IQ Puzzler Pro 3D pyramid mode is out of scope |
| 0-day retention | Photos processed in phone memory only, never stored |
| No auth | Sessions are anonymous UUIDs |
| Children's app | All UI must be usable without reading (icons, colors, visual hints) |
| 3 games only | IQ Puzzler Pro, IQ Noodles, IQ Waves — no other games |
| Latency target | ~4 seconds end-to-end (Wi-Fi) |
| No AWS | Deployed entirely on company's internal infrastructure |
| Privacy | No PII collected, no GDPR consent needed (no data retained) |

---

## 10. Common Pitfalls

- **Don't send photos to the server.** All image processing is on-device. Only JSON payloads go to the backend.
- **Don't use `piece_color` as a database key.** Always use `piece_id`. Color is unreliable under varying lighting.
- **Don't confuse cell grids with graph intersections.** Puzzler Pro uses cells; Noodles uses intersections with CURVE/CROSS encoding. They are fundamentally different.
- **Don't assume all pieces have 8 orientations.** Some are symmetric and have fewer.
- **Don't use color alone for piece identification.** Shape is primary, color is secondary.
- **Don't forget the H/V alternation in Waves.** Slots alternate horizontal and vertical.
- **Don't deploy on AWS.** All infrastructure must be on the company's internal servers.
- **Don't store session state only in memory.** Use PostgreSQL so the dashboard (on a different device) can access the session.

---

## 11. Reference Materials

| Resource | Location |
|----------|----------|
| Project Charter (v2) | `docs/PROJECT_CHARTER.md` |
| PRD | `docs/PRD.md` |
| Tech Stack | `docs/TECH_STACK.md` |
| System Architecture | `docs/SYSTEM_ARCHITECTURE.md` |
| Implementation Plan | `docs/IMPLEMENTATION_PLAN.md` |
| Progress Log | `docs/PROGRESS_LOG.md` |
| IQ Puzzler Pro pieces (reference) | `data/pieces/puzzler_pro.json` |
| STL files | `data/stl/` |

# Tech Stack Specification

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 4, 2026 |

---

## 1. Overview

This document specifies every technology, library, and service used in the Smart NV system — grouped by layer — with version pins, justifications, and alternatives considered.

---

## 2. Frontend

### 2.1 Core Framework

| Technology | Version | Justification |
|-----------|---------|---------------|
| **React** | 18.3+ | Component model, huge ecosystem, team familiarity |
| **TypeScript** | 5.4+ | Type safety across frontend; catches integration bugs early |
| **Vite** | 5.x | Sub-second HMR, ESBuild for dev, Rollup for prod; 10× faster than CRA |

**Alternatives considered:**
- Next.js — SSR unneeded for a single-page dashboard app
- Vue 3 — equivalent capability, but React has wider hiring pool
- Svelte — smaller bundle, but less ecosystem maturity

### 2.2 State Management

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Zustand** | 4.x | Minimal boilerplate, no providers, works with React 18 concurrent features |

**Alternatives considered:**
- Redux Toolkit — too much ceremony for our state shape (one session + one board)
- Jotai — atomic model better for large forms, overkill here

### 2.3 Canvas Rendering

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Konva.js** | 9.x | 2D canvas library with React bindings (`react-konva`), supports layers, hit detection, animations |
| **react-konva** | 18.x | Declarative React wrapper for Konva |

**Used for:** Board grid visualization, piece overlays, hint highlighting, completion confetti

**Alternatives considered:**
- PixiJS — WebGL-first, overkill for 2D grid rendering
- Raw Canvas API — too low-level for interactive overlays
- SVG — performance degrades with many path elements

### 2.4 Networking

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Axios** | 1.7+ | HTTP client for REST endpoints; interceptors for auth/retry |
| **Native WebSocket** | — | Built-in browser API; no wrapper needed for simple pub/sub |

### 2.5 UI Components & Styling

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Tailwind CSS** | 3.4+ | Utility-first, purge-safe, fast prototyping |
| **shadcn/ui** | latest | Accessible, unstyled Radix primitives with Tailwind |
| **Lucide React** | latest | Icon set, tree-shakeable |

### 2.6 Build & Quality

| Tool | Version | Purpose |
|------|---------|---------|
| **ESLint** | 9.x | Linting with flat config |
| **Prettier** | 3.x | Code formatting |
| **Vitest** | 1.x | Unit testing (Vite-native) |
| **Playwright** | 1.x | E2E testing |

---

## 3. Backend

### 3.1 Core Framework

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Python** | 3.11+ | Best ML/CV ecosystem; YOLO, OpenCV, NumPy all Python-first |
| **FastAPI** | 0.111+ | Async, auto-OpenAPI docs, Pydantic v2 validation, WebSocket native |
| **Uvicorn** | 0.30+ | ASGI server; HTTP/1.1 + WebSocket on same port |

**Alternatives considered:**
- Flask — no async, no auto-docs, manual validation
- Django — full ORM/admin overhead, unnecessary for API-only service
- Node.js/Express — Python needed anyway for CV; avoids polyglot backend

### 3.2 Validation & Serialization

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Pydantic** | 2.7+ | Request/response models, `.model_dump()` for JSON, strict mode |

### 3.3 Database

| Technology | Version | Justification |
|-----------|---------|---------------|
| **PostgreSQL** | 16+ | Game/piece definitions, session history, structured JSON columns |
| **SQLAlchemy** | 2.0+ | Async ORM with `asyncpg` driver |
| **Alembic** | 1.13+ | Schema migrations |

**Alternatives considered:**
- SQLite — no concurrent writes for sessions
- MongoDB — schemaless not needed; game/piece data is highly structured

### 3.4 Cache & Pub/Sub

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Redis** | 7.2+ | Session state cache (TTL), pub/sub for board-state → WebSocket fan-out |

**Usage pattern:**
```
Photo upload → CV pipeline → board_state written to Redis
                                → Redis PUBLISH "session:{id}"
                                    → WebSocket handler SUBSCRIBEs
                                        → pushes to React client
```

### 3.5 Puzzle Solver

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Algorithm X (DLX)** | Custom impl. | Donald Knuth's exact cover algorithm with Dancing Links data structure. Purpose-built for polyomino/puzzle packing problems. All 3 games are exact cover problems. |

**Implementation:** Pure Python with NumPy for matrix operations. No external solver library needed — DLX is compact (~200 lines) and has no dependencies beyond the standard library.

**How it works for each game:**
- **IQ Puzzler Pro:** Columns = 55 cells (front) or ~38 active cells (back) + 12 piece-used flags. Rows = all valid placements of each piece in each orientation at each position.
- **IQ Noodles:** Columns = 21 knobs + 11 piece-used flags. Rows = all valid path placements for each piece at each starting knob/direction.
- **IQ Waves:** Columns = 32 slots + 8 piece-used flags. Rows = all valid placements of each piece at each position/orientation/side.

**Alternatives considered:**
- `python-constraint` (CSP) — Clean API but too slow for 55-cell boards with 12 pieces
- pysat (SAT solver) — Powerful but complex encoding, hard to extract piece placements
- Google OR-Tools (ILP) — Industrial-strength but heavyweight dependency, overkill for this problem size
- Backtracking without DLX — Works but significantly slower for harder configurations

**Performance target:** <500ms per solve on CPU for all games.

### 3.6 Task Queue (Optional — Phase 2)

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Celery** | 5.4+ | If pipeline latency exceeds 2s, offload CV to worker pool |
| **Redis** | (shared) | Broker for Celery |

---

## 4. Computer Vision

### 4.1 Object Detection & Segmentation

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Ultralytics YOLO** | ≥ 8.3 (YOLO26) | State-of-art OBB + segmentation; Python SDK; ONNX export |
| **YOLO OBB** | — | Oriented bounding boxes for angled board detection |
| **YOLO Segmentation** | — | Per-piece pixel masks for color + shape extraction |

**Model sizes:** Using `-S` (small) variants for CPU inference; `-M` if GPU available.

**Alternatives considered:**
- Detectron2 — heavier, slower, Meta-centric
- MediaPipe — limited custom training support
- Classical CV only — insufficient for varying lighting/angles

### 4.2 Image Processing

| Technology | Version | Justification |
|-----------|---------|---------------|
| **OpenCV** | 4.13+ | Homography warp, contour analysis, color space conversion, template matching |
| **NumPy** | 1.26+ | Array operations for grid mapping, mask manipulation |
| **Pillow** | 10.x | Image I/O, format conversion |

### 4.3 3D Template Matching

| Technology | Version | Justification |
|-----------|---------|---------------|
| **trimesh** | 4.x | Load STL files, render piece silhouettes at known orientations |
| **Open3D** | 0.18+ | Alternative STL loader with visualization (dev-time) |

**Usage:** STL files for each game → render all valid piece orientations → generate binary mask templates → IoU matching against YOLO-seg masks.

### 4.4 Training Infrastructure

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Roboflow** | — | Annotation tool; exports YOLO format; augmentation pipeline |
| **CVAT** | — | Alternative annotation (self-hosted) |
| **Ultralytics Hub** | — | Cloud training if local GPU unavailable |

**Dataset requirements:**
| Game | Training images | Annotation type |
|------|----------------|-----------------|
| IQ Puzzler Pro | 200–400 | OBB (board) + Segmentation (pieces) |
| IQ Noodles | 200–400 | OBB (board) + Segmentation (pieces) |
| IQ Waves | 200–400 | OBB (board) + Segmentation (pieces) |

---

## 5. Infrastructure

### 5.1 Development Environment

| Tool | Version | Purpose |
|------|---------|---------|
| **Docker** | 24+ | Containerized services (API, Redis, Postgres) |
| **Docker Compose** | 2.24+ | Multi-service orchestration for local dev |
| **VS Code** | latest | Primary IDE with Python + React extensions |
| **Git** | 2.43+ | Version control |
| **GitHub** | — | Remote repository, CI/CD via Actions |

### 5.2 Container Images

| Service | Base Image | Ports |
|---------|------------|-------|
| `api` | `python:3.11-slim` | 8000 |
| `redis` | `redis:7.2-alpine` | 6379 |
| `postgres` | `postgres:16-alpine` | 5432 |
| `frontend` | `node:20-alpine` → `nginx:alpine` (prod) | 3000 (dev) / 80 (prod) |

### 5.3 CI/CD

| Tool | Purpose |
|------|---------|
| **GitHub Actions** | Lint, test, build, deploy on push/PR |
| **Pre-commit** | Local hooks: black, ruff, eslint, prettier |

### 5.4 Production (Phase 2)

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Kubernetes** | 1.29+ | Container orchestration for scaling CV workers |
| **NGINX Ingress** | — | TLS termination, WebSocket upgrade |
| **Helm** | 3.x | K8s deployment templating |

---

## 6. Testing

| Layer | Tool | Target |
|-------|------|--------|
| **Backend Unit** | pytest 8.x + pytest-asyncio | FastAPI routes, grid mappers, hint engine |
| **CV Pipeline** | pytest + custom fixtures | Per-image accuracy; IoU thresholds |
| **Frontend Unit** | Vitest | React components, Zustand stores |
| **Frontend E2E** | Playwright | Full user flows (capture → dashboard → hint) |
| **Integration** | Docker Compose test profile | API ↔ Redis ↔ Postgres round-trip |

---

## 7. Monitoring & Observability (Phase 2)

| Technology | Purpose |
|-----------|---------|
| **Prometheus** | Metrics collection (pipeline latency, detection accuracy) |
| **Grafana** | Dashboards |
| **Loki** | Log aggregation |
| **Sentry** | Error tracking (frontend + backend) |

---

## 8. Security & Privacy

| Concern | Solution |
|---------|----------|
| Image storage | Photos deleted after session ends (no persistent storage) |
| GDPR | No PII collected; session IDs are anonymous UUIDs |
| HTTPS | TLS via NGINX/Ingress in production |
| CORS | Allow-list frontend origins only |
| Rate limiting | FastAPI middleware, 10 photos/min per session |

---

## 9. Version Pinning Strategy

All dependencies pinned in:
- **Backend:** `pyproject.toml` with `uv.lock` (or `requirements.txt` with `pip-compile`)
- **Frontend:** `package.json` with `pnpm-lock.yaml`
- **Infrastructure:** Docker image tags pinned to specific versions (no `latest`)
- **YOLO models:** Versioned in `models/` directory with SHA256 checksums

---

## 10. Dependency Summary

```
Frontend:  React 18 · TypeScript 5.4 · Vite 5 · Konva 9 · Zustand 4 · Tailwind 3.4
Backend:   Python 3.11 · FastAPI 0.111 · Pydantic 2.7 · SQLAlchemy 2.0 · Alembic 1.13
CV:        Ultralytics YOLO26 (OBB + Seg) · OpenCV 4.13 · NumPy 1.26 · trimesh 4
Solver:    Algorithm X with Dancing Links (DLX) — custom Python implementation
Data:      PostgreSQL 16 · Redis 7.2
Infra:     Docker 24 · GitHub Actions · K8s 1.29 (Phase 2)
Testing:   pytest 8 · Vitest 1 · Playwright 1
```

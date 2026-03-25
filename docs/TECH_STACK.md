# Tech Stack Specification

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 16, 2026 |

---

## 1. Overview

This document specifies every technology, library, and service used in the Smart NV system — grouped by layer — with version pins, justifications, and alternatives considered.

**Key architectural decision:** ML inference runs entirely on-device (YOLO26 nano on the user's phone). The backend receives only lightweight grid-state payloads and runs the DLX solver. No photos are transmitted or stored.

---

## 2. Frontend (Phone Client + Dashboard)

### 2.1 Core Framework

| Technology | Version | Justification |
|-----------|---------|---------------|
| **React** | 18.3+ | Component model, huge ecosystem, team familiarity |
| **Vite** | 5.x | Sub-second HMR, ESBuild for dev, Rollup for prod |

**Alternatives considered:**
- Next.js — SSR unneeded for a single-page app
- Vue 3 — equivalent capability, but React has wider hiring pool

### 2.2 On-Device ML

| Technology | Version | Justification |
|-----------|---------|---------------|
| **YOLO26 Nano** | Latest | On-device inference for piece detection, bounding, and segmentation natively on the phone |

The YOLO26 nano model is loaded and executed directly on the user's phone. The phone handles all image processing locally and constructs a lightweight JSON payload of detected piece positions to send to the backend.

### 2.3 Build & Quality

| Tool | Version | Purpose |
|------|---------|---------|
| **ESLint** | 9.x | Linting |
| **Prettier** | 3.x | Code formatting |
| **Vitest** | 1.x | Unit testing (Vite-native) |

---

## 3. Backend

### 3.1 Core Framework

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Python** | 3.11+ | Best ML/CV ecosystem; OpenCV, NumPy all Python-first |
| **FastAPI** | 0.111+ | Async, auto-OpenAPI docs, Pydantic v2 validation |
| **Uvicorn** | 0.30+ | ASGI server |

**Alternatives considered:**
- Flask — no async, no auto-docs, manual validation
- Django — full ORM/admin overhead, unnecessary for API-only service
- Node.js/Express — Python needed anyway for solver and CV tooling

### 3.2 Validation & Serialization

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Pydantic** | 2.7+ | Request/response models, `.model_dump()` for JSON, strict mode |

### 3.3 Database

| Technology | Version | Justification |
|-----------|---------|---------------|
| **PostgreSQL** | 16+ | Game/piece definitions, session state for cross-device dashboard visibility |
| **SQLAlchemy** | 2.0+ | ORM with async support |
| **Alembic** | 1.13+ | Schema migrations |

### 3.4 Puzzle Solver

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Algorithm X (DLX)** | Custom impl. | Donald Knuth's exact cover algorithm with Dancing Links. Purpose-built for polyomino/puzzle packing. All 3 games are exact cover problems. |

**Implementation:** Pure Python with NumPy for matrix operations. DLX is compact (~200 lines) with no external dependencies.

**How it works for each game:**
- **IQ Puzzler Pro:** Columns = 55 cells (front) or active cells (back) + 12 piece-used flags. Rows = all valid placements of each piece in each orientation at each position.
- **IQ Noodles:** Columns = intersection nodes + 11 piece-used flags. Rows = all valid path placements for each piece.
- **IQ Waves:** Columns = 32 slots + 8 piece-used flags. Rows = all valid placements of each piece at each position/orientation.

**Alternatives considered:**
- `python-constraint` (CSP) — Too slow for 55-cell boards with 12 pieces
- pysat (SAT solver) — Complex encoding, hard to extract piece placements
- Google OR-Tools (ILP) — Heavyweight dependency, overkill for this problem size

**Performance target:** ≤ 1.5s per solve on CPU for all games.

---

## 4. Computer Vision & Training

### 4.1 Object Detection & Segmentation

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Ultralytics YOLO** | ≥ 8.3 (YOLO26) | State-of-art segmentation; Python SDK for training |
| **YOLO26 Nano** | — | Nano variant chosen for on-device phone inference (faster, smaller model) |

### 4.2 Image Processing

| Technology | Version | Justification |
|-----------|---------|---------------|
| **OpenCV** | 4.13+ | Augmentation, 2D projection, contour analysis for synthetic data generation |
| **NumPy** | 1.26+ | Array operations for mask manipulation |

### 4.3 3D Synthetic Data Generation

| Technology | Version | Justification |
|-----------|---------|---------------|
| **trimesh** | 4.x | Load STL files, render piece silhouettes for synthetic training data |

**Usage:** STL files → render all valid piece orientations → generate synthetic board images → train YOLO26 nano model.

### 4.4 Training & Annotation

| Technology | Version | Justification |
|-----------|---------|---------------|
| **Roboflow** | — | Real-world photo annotation (polygon mask labeling), augmentation pipeline, YOLO export format |

**Dataset strategy:**
- Real data: ~100+ photos per game, labelled on Roboflow
- Synthetic data: Generated from scaled 3D STL files
- Mix: ~60% synthetic + ~40% real photos

---

## 5. Infrastructure

### 5.1 Development Environment

| Tool | Version | Purpose |
|------|---------|---------|
| **VS Code** | latest | Primary IDE |
| **Git** | 2.43+ | Version control |
| **GitHub** | — | Remote repository |

### 5.2 Deployment

| Technology | Purpose |
|-----------|---------|
| **Company Internal Infrastructure** | All backend services hosted locally — no AWS |
| **Python + FastAPI** | Backend API server |
| **PostgreSQL** | Database for games, pieces, sessions |

> **No AWS, no K8s, no Docker required for deployment.** The system is deployed entirely on the company's internal infrastructure.

---

## 6. Testing

| Layer | Tool | Target |
|-------|------|--------|
| **Backend Unit** | pytest 8.x + pytest-asyncio | FastAPI routes, solver, hint engine |
| **Frontend Unit** | Vitest | React components |
| **CV Pipeline** | pytest + custom fixtures | Per-image accuracy; model validation |

---

## 7. Security & Privacy

| Concern | Solution |
|---------|----------|
| **Photo handling** | 0-day retention — photos processed only in phone memory, never transmitted or stored |
| **Data transmission** | Only lightweight JSON grid-state payloads sent to server |
| **Privacy** | No PII collected; no GDPR consent needed because no data is retained |
| **Sessions** | Anonymous UUID, no authentication required |
| **HTTPS** | TLS for all API communication |
| **CORS** | Allow-list frontend origins only |

---

## 8. Version Pinning Strategy

All dependencies pinned in:
- **Backend:** `pyproject.toml` with `requirements.txt`
- **Frontend:** `package.json` with lock file
- **YOLO models:** Versioned in `models/` directory with SHA256 checksums

---

## 9. Dependency Summary

```
Frontend:  React 18 · Vite 5
On-Device: YOLO26 Nano (on-device phone inference)
Backend:   Python 3.11 · FastAPI 0.111 · Pydantic 2.7 · SQLAlchemy 2.0 · Alembic 1.13
CV/Train:  Ultralytics YOLO26 · OpenCV 4.13 · NumPy 1.26 · trimesh 4 · Roboflow
Solver:    Algorithm X with Dancing Links (DLX) — custom Python implementation
Data:      PostgreSQL 16
Testing:   pytest 8 · Vitest 1
```

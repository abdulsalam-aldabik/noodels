# Progress Log

## Smart NV Computer Vision Puzzle Tracking System

---

## How to Use This Log

Add entries in reverse chronological order (newest first). Each entry should include:
- **Date**
- **Sprint** (Sprint 1, 2, 3)
- **What was done** (facts only)
- **Decisions made** (and why)
- **Blockers** (if any)
- **Next steps**

---

## Log Entries

### 2026-03-16 — Project Charter v2: On-Device Architecture Overhaul

**Sprint:** Pre-Sprint 1
**What was done:**
- New Project Charter v2 established as the authoritative project document
- Major architecture shift: **on-device YOLO26 nano inference** (phone processes images locally, not the server)
- Replaced server-side CV pipeline with on-device processing → lightweight JSON grid-state payload → backend solver
- **No AWS** — all deployment on company's internal infrastructure
- **0-day data retention** — photos handled only in phone memory, never transmitted or stored. No GDPR consent needed.
- Simplified to **3 sprints** with 3 core engineers, each owning one puzzle game
- Updated IQ Noodles piece encoding to **CURVE/CROSS_NS/CROSS_EW** from Java source reference (replaces placeholder S/L/R/E turn sequences)
- Updated all project docs (PRD, System Architecture, Tech Stack, Implementation Plan, agents.md) to align with charter v2
- Kept **PostgreSQL** for sessions/games/pieces (needed for cross-device dashboard visibility)
- Kept **STL synthetic data pipeline** for training data generation (trimesh + OpenCV)
- Kept **DLX solver** (Algorithm X / backtracking) on the backend

**Decisions made:**
1. **On-device inference (YOLO26 nano)** — model runs natively on the phone; only grid-state payloads sent to server. No photos ever leave the device.
2. **Company internal infrastructure** — no AWS, no K8s, no Docker for deployment
3. **0-day retention** — simplifies privacy; no consent forms needed
4. **Discrete dashboard sync** — dashboard updates via HTTP on each photo submission, not real-time WebSocket push
5. **3-member team ownership** — Member 1: IQ Puzzler Pro + dashboard, Member 2: IQ Noodles, Member 3: IQ Waves

**What was removed from the old architecture:**
- Server-side CV pipeline (board detector, piece segmentor, homography, STL template matcher at runtime)
- AWS EC2, K8s, Helm, NGINX Ingress
- Redis pub/sub + WebSocket real-time push
- ONNX Runtime, Celery task queue
- Docker Compose for deployment
- GDPR consent workflows, S3 photo storage

**Blockers:** None

**Next steps:**
- Begin Sprint 1: infrastructure setup, per-game board mapping, initial Roboflow labeling
- Train initial YOLO26 nano model on synthetic + real data
- Set up PostgreSQL with games/pieces/sessions schema

---

### 2026-03-10 — Color Palette Verification + YOLO26-N Switch

**Sprint:** Pre-Sprint 1
**What was done:**
- Verified exact color palette for all 11 IQ Noodles pieces (A–K) against physical game pieces
- Updated piece colors across all project documents (PRD, Project Charter) and training notebook
- Switched all YOLO model references from **YOLO26-S** (Small) to **YOLO26-N** (Nano) across notebook, PRD, System Architecture, and Project Charter
- Confirmed IQ Noodles has **11 pieces** (A–K), not 12 — removed all references to piece L
- Updated color disambiguation note: all 11 colors are now distinctly separated (no more red/crimson confusion)
- Roboflow being used for real photo annotation (~100 photos of physical pieces)

**Verified Color Palette (11 pieces):**

| ID | Color Name | Hex |
|----|-----------|-----|
| A | YellowGreen | #95D450 |
| B | Red | #EE394F |
| C | DarkBlue | #206DD9 |
| D | Purple | #C778B9 |
| E | Orange | #FC690C |
| F | SkyBlue | #08A7E8 |
| G | Green | #1FA15B |
| H | DarkRed | #B63048 |
| I | Yellow | #F9D65E |
| J | Pink | #EC71A8 |
| K | Teal | #85DABB |

**Decisions made:**
1. **YOLO26-N (Nano)** chosen over YOLO26-S (Small) — faster inference, smaller model, sufficient accuracy for 11-class segmentation
2. **Roboflow** for real photo annotation — polygon mask labeling with YOLO11 Instance Segmentation export format

**Blockers:** None

**Next steps:**
- Complete Roboflow annotation of ~100 real photos
- Re-train YOLO26-N on synthetic + real photo dataset
- Validate all 11 pieces are detected reliably

---

### 2026-03-05 — Architecture Overhaul: DLX Solver Replaces Challenge DB

**Sprint:** Pre-Sprint 1
**What was done:**
- Major architecture change across all project documents
- Replaced the pre-encoded challenge database (320 challenges) with a **live DLX solver** (Algorithm X with Dancing Links)
- Changed user flow: user now **selects the puzzle from a menu** first, then scans the board
- Removed all challenge encoding tasks from sprint plan
- Added solver implementation tasks
- Removed challenge matcher, fingerprint hashing, and challenges DB table
- Added `solver/` module to backend architecture (dlx.py, base.py, puzzler_pro.py, noodles.py, waves.py)

**Decisions made:**
1. **Algorithm X with Dancing Links (DLX)** chosen as solver — purpose-built for exact cover problems
2. **No challenge database at all** — solver computes solutions live from any board state
3. **User selects game from menu** — no automatic game detection

**Why:**
- Eliminates manual challenge encoding work
- Supports freestyle play (not just booklet challenges)
- No risk of encoding errors
- Solver well within performance budget

**Blockers:** None

**Next steps:**
- Implement DLX solver core
- Benchmark solver on IQ Puzzler Pro empty board
- Formulate exact cover matrices for each game type

---

*(No earlier entries — this is the first baseline.)*

---

*Add new entries above this line.*

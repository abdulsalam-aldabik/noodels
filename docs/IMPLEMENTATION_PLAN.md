# Implementation Plan

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 4, 2026 |
| **Sprint Length** | 2 weeks |
| **Team Size** | ~3 developers |

---

## 1. Phase Overview

| Phase | Sprints | Duration | Scope |
|-------|---------|----------|-------|
| **Sprint 0** | Pre-sprint | 1 week | Research, data encoding, project setup |
| **Sprint 1** | Sprint 1 | 2 weeks | Board detection (IQ Puzzler Pro) |
| **Sprint 2** | Sprint 2 | 2 weeks | Piece detection + challenge matching + hints |
| **Sprint 3** | Sprint 3 | 2 weeks | Full UX + IQ Noodles + user testing |
| **Phase 2** | Sprint 4–5 | 4 weeks | IQ Waves + hardening + deployment |

**Total estimated duration:** 11 weeks

---

## 2. Sprint 0 — Foundation (Week 0)

**Goal:** Project scaffolding, piece data encoding, STL template generation, solver prototype.

### 2.1 Tasks

| # | Task | Owner | Est. | Deliverable |
|---|------|-------|------|-------------|
| 0.1 | Initialize monorepo structure | Dev 1 | 2h | `frontend/`, `backend/`, `models/`, `data/` |
| 0.2 | Docker Compose: FastAPI + Redis + Postgres | Dev 1 | 3h | `docker-compose.yml` working |
| 0.3 | React + Vite + TypeScript scaffold | Dev 2 | 2h | `frontend/` with Tailwind, Konva, routing |
| 0.4 | FastAPI scaffold with SQLAlchemy + Alembic | Dev 1 | 3h | `/api/v1/health` responding |
| 0.5 | Encode IQ Puzzler Pro pieces → `pieces.json` | Dev 3 | 3h | 12 pieces × all orientations |
| 0.6 | Implement DLX solver core (Algorithm X with Dancing Links) | Dev 3 | 8h | `solver/dlx.py` with unit tests |
| 0.7 | IQ Puzzler Pro exact cover formulation | Dev 3 | 4h | `solver/puzzler_pro.py` solving empty board in <500ms |
| 0.8 | Render STL templates for IQ Puzzler Pro (front + back) | Dev 4 | 5h | Binary mask images per piece × orientation for both grids |
| 0.9 | Database schema + seed migration (games + pieces only) | Dev 1 | 2h | Alembic migration + seed script |
| 0.10 | Set up Roboflow project, upload initial images | Dev 4 | 3h | Annotation project created |
| 0.11 | CI pipeline: lint + test on push | Dev 2 | 2h | GitHub Actions workflow |
| 0.12 | Trace IQ Noodles physical pieces → validate turn sequences | Dev 3 | 4h | Noodles piece data validated |
| 0.13 | Physically map 8×5 back grid binary matrix | Dev 3 | 1h | Verified active-cell mask for back board |
| 0.14 | Game selector UI (user chooses puzzle before scanning) | Dev 2 | 2h | Game selection screen in React |

> **Key change:** Sprint 0 no longer encodes 320 challenge solutions. Instead, it focuses on implementing the DLX solver which computes solutions live from any board state.

**Sprint 0 Total:** ~43 person-hours

### 2.2 Acceptance Criteria

- [ ] `docker compose up` starts all services
- [ ] `GET /api/v1/health` returns 200
- [ ] React app renders at `localhost:3000` with game selector
- [ ] DLX solver solves empty IQ Puzzler Pro board (front + back) in <500ms
- [ ] 12 pieces with all unique orientations computed
- [ ] IQ Noodles turn sequences validated against physical pieces
- [ ] STL-rendered templates for IQ Puzzler Pro exist in `models/templates/`
- [ ] CI passes on main branch

---

## 3. Sprint 1 — Board Detection (Weeks 1–2)

**Goal:** Phone photo → board detected → rectified image displayed on dashboard.

### 3.1 Tasks

| # | Task | Owner | Est. | Deliverable |
|---|------|-------|------|-------------|
| 1.1 | Capture 200+ photos of IQ Puzzler Pro | All | 4h | Raw dataset in Roboflow |
| 1.2 | Annotate board corners (OBB) | All | 6h | Labeled dataset exported |
| 1.3 | Train YOLO OBB board detector | Dev 4 | 4h | Model with ≥95% mAP |
| 1.4 | Board detection API endpoint | Dev 1 | 4h | `/api/v1/sessions/{id}/photos` |
| 1.5 | Homography warp module | Dev 4 | 3h | `cv/homography.py` tested |
| 1.6 | Photo capture UI (mobile) | Dev 2 | 4h | Camera capture + upload |
| 1.7 | WebSocket infrastructure | Dev 1 | 4h | Redis pub/sub → WS → React |
| 1.8 | Board canvas (Konva.js) — empty grid | Dev 2 | 4h | 5×11 grid rendering |
| 1.9 | Session management (create/get) | Dev 1 | 3h | CRUD endpoints + Redis state |
| 1.10 | Integration test: photo → rectified → dashboard | Dev 3 | 3h | E2E test passing |
| 1.11 | Annotate piece segmentation masks (start) | Dev 3 | 6h | 100+ annotated images |
| 1.12 | **Parallel:** IQ Noodles exact cover formulation for DLX solver | Dev 3 | 8h | Noodles solver passing unit tests |

**Sprint 1 Total:** ~61 person-hours

### 3.2 Acceptance Criteria

- [ ] User takes photo on phone → board detected → rectified image visible on dashboard
- [ ] Board detection accuracy ≥ 95% across test images
- [ ] Homography produces clean top-down view
- [ ] WebSocket delivers state update within 500ms
- [ ] Working on both iOS Safari and Android Chrome

---

## 4. Sprint 2 — Piece Detection + Hints (Weeks 3–4)

**Goal:** Full pipeline for IQ Puzzler Pro — photo to hints.

### 4.1 Tasks

| # | Task | Owner | Est. | Deliverable |
|---|------|-------|------|-------------|
| 2.1 | Complete piece segmentation annotations | Dev 3 | 6h | 200+ images annotated |
| 2.2 | Train YOLO Seg piece segmentor | Dev 4 | 4h | mAP@0.5 ≥ 0.90 |
| 2.3 | Piece segmentation module | Dev 4 | 3h | `cv/piece_segmentor.py` |
| 2.4 | STL template matcher | Dev 4 | 6h | `cv/template_matcher.py` |
| 2.5 | Puzzler Pro grid mapper | Dev 3 | 4h | `cv/grid_mappers/puzzler_pro.py` |
| 2.6 | Solver integration into pipeline (DLX solves after grid mapping) | Dev 1 | 4h | `solver/` integrated into `cv/pipeline.py` |
| 2.7 | Diff engine (current state vs solver output) | Dev 1 | 3h | `engine/diff.py` |
| 2.8 | Hint engine (3 tiers, driven by solver solution) | Dev 1 | 4h | `engine/hints.py` |
| 2.9 | Piece status panel UI | Dev 2 | 3h | Placed/unplaced/misplaced indicators |
| 2.10 | Hint display UI | Dev 2 | 3h | Tier 1/2/3 rendering on board |
| 2.11 | Completion detection + celebration | Dev 2 | 3h | Confetti + score |
| 2.12 | Pipeline orchestrator | Dev 1 | 4h | `cv/pipeline.py` end-to-end |
| 2.13 | Integration tests: full pipeline | Dev 3 | 4h | 10 test photos with known solutions |

**Sprint 2 Total:** ~50 person-hours

### 4.2 Acceptance Criteria

- [ ] Photo of IQ Puzzler Pro → all placed pieces correctly identified
- [ ] Solver computes valid solution for any partial board state in <500ms
- [ ] Tier 1/2/3 hints displayed correctly (driven by solver output)
- [ ] Completion detected when puzzle is solved
- [ ] End-to-end latency ≤ 2s (P95)
- [ ] Per-piece recognition accuracy ≥ 92%

---

## 5. Sprint 3 — IQ Noodles + UX Polish (Weeks 5–6)

**Goal:** Add IQ Noodles support, polish UX, conduct user testing.

### 5.1 Tasks

| # | Task | Owner | Est. | Deliverable |
|---|------|-------|------|-------------|
| 3.1 | Encode IQ Noodles pieces (11 pieces, turn sequences) | Dev 3 | 4h | Noodles pieces in DB |
| 3.2 | Verify IQ Noodles DLX solver (from Sprint 1 parallel work) | Dev 3 | 4h | Solver handles all Noodles board states |
| 3.3 | Render STL templates for IQ Noodles | Dev 4 | 4h | Noodle piece silhouettes |
| 3.4 | Capture + annotate IQ Noodles photos (200+) | All | 8h | Labeled dataset |
| 3.5 | Train board detector (add Noodles class) | Dev 4 | 3h | 2-class OBB model |
| 3.6 | Train Noodles piece segmentor | Dev 4 | 4h | Noodles seg model |
| 3.7 | Noodles knob-edge grid mapper | Dev 3 | 6h | `cv/grid_mappers/noodles.py` |
| 3.8 | Noodles board canvas (Konva.js) | Dev 2 | 4h | Knob-edge graph rendering |
| 3.9 | Game selector UI | Dev 2 | 2h | Switch between Puzzler Pro / Noodles |
| 3.10 | UX polish: loading states, errors, transitions | Dev 2 | 4h | Polished user experience |
| 3.11 | User testing (5–8 families) | All | 8h | Feedback collected, issues logged |
| 3.12 | Bug fixes from user testing | All | 6h | Critical issues resolved |

**Sprint 3 Total:** ~57 person-hours

### 5.2 Acceptance Criteria

- [ ] IQ Noodles board detection works with ≥ 95% accuracy
- [ ] IQ Noodles pieces correctly identified and mapped to knob-edge graph
- [ ] DLX solver computes valid solutions for IQ Noodles boards
- [ ] Hints work for Noodles (solver-driven)
- [ ] User testing: satisfaction ≥ 4.0/5.0
- [ ] No critical bugs remaining

---

## 6. Phase 2 — IQ Waves + Hardening (Weeks 7–10)

**Goal:** Add third game, harden the system, prepare for production.

### 6.1 Sprint 4: IQ Waves (Weeks 7–8)

| # | Task | Owner | Est. |
|---|------|-------|------|
| 4.1 | Encode IQ Waves pieces (8 pieces, slot offsets + profiles) | Dev 3 | 4h |
| 4.2 | IQ Waves DLX solver formulation (H/V slot exact cover) | Dev 3 | 8h |
| 4.3 | Render STL templates for IQ Waves | Dev 4 | 3h |
| 4.4 | Capture + annotate IQ Waves photos (200+) | All | 8h |
| 4.5 | Train board detector (add Waves class) | Dev 4 | 3h |
| 4.6 | Train Waves piece segmentor | Dev 4 | 4h |
| 4.7 | Waves H/V slot grid mapper | Dev 3 | 6h |
| 4.8 | Waves board canvas (Konva.js) | Dev 2 | 4h |
| 4.9 | Wave profile boundary validation | Dev 3 | 4h |
| 4.10 | Integration testing for all 3 games | Dev 1 | 4h |

### 6.2 Sprint 5: Hardening + Deployment (Weeks 9–10)

| # | Task | Owner | Est. |
|---|------|-------|------|
| 5.1 | Kubernetes manifests / Helm chart | Dev 1 | 6h |
| 5.2 | NGINX Ingress with TLS | Dev 1 | 3h |
| 5.3 | Monitoring: Prometheus + Grafana | Dev 1 | 4h |
| 5.4 | Error tracking: Sentry integration | Dev 2 | 2h |
| 5.5 | Performance optimization (ONNX export) | Dev 4 | 4h |
| 5.6 | Load testing (simulate 50 concurrent sessions) | Dev 3 | 3h |
| 5.7 | Security audit: rate limits, CORS, input validation | Dev 1 | 3h |
| 5.8 | Final user testing round (5+ families) | All | 6h |
| 5.9 | Documentation: README, API docs, deployment guide | All | 4h |
| 5.10 | Demo preparation | All | 4h |

---

## 7. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Low piece segmentation accuracy | Medium | High | Augment with more training data; fallback to color-only detection |
| IQ Noodles curved pieces harder to detect | High | Medium | Start noodle data collection early (Sprint 1); invest in STL matching |
| Wave profile matching complexity | Medium | Medium | Simplify to slot-level occupancy first, add profile matching later |
| Lighting variation degrades CV | Medium | High | Augment training with brightness/contrast variations; add preprocessing |
| DLX solver too slow for complex boards | Low | Medium | Profile and optimize; IQ Puzzler Pro (55 cells, 12 pieces) is well within DLX capability; cache solutions in Redis |
| WebSocket connection drops on mobile | Medium | Low | Auto-reconnect with exponential backoff; last-state cache |

---

## 8. Definition of Done (Global)

Every task is done when:
- [ ] Code is written and follows project conventions
- [ ] Unit tests pass (≥ 80% coverage for new code)
- [ ] Integration tests pass (if applicable)
- [ ] Code reviewed by at least one other team member
- [ ] No linting errors
- [ ] Documentation updated (if API/schema changed)
- [ ] Feature demonstrated in sprint review

---

## 9. Milestone Summary

```
Week 0  ─── Sprint 0: Foundation
             ✓ Repo + Docker + DB + DLX solver core + Puzzler Pro solver
             
Week 1-2 ── Sprint 1: Board Detection + Noodles solver (parallel)
             ✓ Phone → board detected → rectified on dashboard
             ✓ Noodles DLX solver formulation in parallel
             
Week 3-4 ── Sprint 2: Full Pipeline (IQ Puzzler Pro)
             ✓ Photo → pieces → solver → hints → completion
             
Week 5-6 ── Sprint 3: IQ Noodles + UX + User Testing
             ✓ 2 games working, tested with families
             
Week 7-8 ── Sprint 4: IQ Waves
             ✓ All 3 games working (DLX solver for each)
             
Week 9-10 ─ Sprint 5: Hardening + Deployment
             ✓ Production-ready, monitored, documented

Week 11 ─── Buffer / Demo Prep
             ✓ Final demo delivered
```

# Implementation Plan

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 16, 2026 |
| **Team Size** | 3 core engineers |

---

## 1. Team Structure & Ownership

| Member | Primary Ownership | Scope |
|--------|------------------|-------|
| **Member 1** | IQ Puzzler Pro | Front 2D + Back 2D modes, dashboard UI base |
| **Member 2** | IQ Noodles | Curve/cross topology matrices (from Java source structures) |
| **Member 3** | IQ Waves | Slot boundary constraints, H/V mappings |

All members share responsibility for: company infrastructure setup, API standardization, YOLO26 nano deployment, and real-world image labelling on Roboflow.

---

## 2. Sprint 1 — Architecture & Model Validation

**Goal:** Infrastructure setup, per-game board/piece data mapping, initial model training, baseline inference checks.

### 2.1 Tasks

| # | Task | Owner | Deliverable |
|---|------|-------|-------------|
| 1.1 | Configure company internal infrastructure (no AWS) | All | Standardized server setup |
| 1.2 | Standardize API structures (FastAPI + Pydantic) | All | API contract agreed |
| 1.3 | Map exact 55-cell tracking config (Pro Front/Back) | Member 1 | Board config verified against physical board |
| 1.4 | Map Back 2D active-cell mask | Member 1 | Verified active-cell matrix |
| 1.5 | Program curve/cross segment logic for Noodles | Member 2 | Noodles piece definitions from Java source |
| 1.6 | Validate orthogonal constraints of IQ Waves | Member 3 | Waves H/V slot constraints verified |
| 1.7 | Capture real-world photos + label on Roboflow | All | Initial labelled dataset |
| 1.8 | Initial YOLO26 nano inference checks | All | Baseline accuracy measurement |
| 1.9 | Generate STL synthetic training data | All | Synthetic dataset from 3D STL files |
| 1.10 | PostgreSQL schema: games, pieces, sessions | Member 1 | Database migration + seed data |
| 1.11 | React + Vite app scaffold (phone + dashboard) | Member 1 | Basic app shell with game selector |

### 2.2 Acceptance Criteria

- [ ] Company infrastructure configured and API server responding
- [ ] IQ Puzzler Pro 55-cell layout verified (front + back)
- [ ] IQ Noodles CURVE/CROSS_NS/CROSS_EW logic programmed from Java source
- [ ] IQ Waves H/V constraints validated — no diagonal placement logic
- [ ] Roboflow project with initial real-world photos labelled
- [ ] Baseline YOLO26 nano inference running
- [ ] STL synthetic training data generated

---

## 3. Sprint 2 — DLX / Backtracking Integrations

**Goal:** Per-game solver implementations, on-device YOLO26 nano deployment, API integration.

### 3.1 Tasks

| # | Task | Owner | Deliverable |
|---|------|-------|-------------|
| 2.1 | DLX constraints for Puzzler Pro (55-cell layout masks) | Member 1 | Solver passing unit tests (front + back modes) |
| 2.2 | Algorithm X logic for Noodles (node/edge placements) | Member 2 | Solver handling all Noodles board states |
| 2.3 | Waves solver constraints (no diagonal) | Member 3 | Waves solver passing unit tests |
| 2.4 | Finalize on-device YOLO26 nano deployment | All | Model running natively on phone |
| 2.5 | Backend API: solve endpoint (receive grid state → return hints) | All | `/api/v1/sessions/{id}/solve` working |
| 2.6 | Diff engine + hint generation | Member 1 | Hints derived from solver output |
| 2.7 | Continue Roboflow annotation + model re-training | All | Improved model accuracy |

### 3.2 Acceptance Criteria

- [ ] DLX solver computes valid solutions for IQ Puzzler Pro (front + back) in ≤ 1.5s
- [ ] Algorithm X handles all IQ Noodles board states without intersection errors
- [ ] Waves solver correctly enforces no-diagonal-placement constraint
- [ ] YOLO26 nano running on-device on phone
- [ ] On-device inference → API → solver → hints pipeline working end-to-end

---

## 4. Sprint 3 — UI, Synchronization & Deployment Polish

**Goal:** Complete phone-to-dashboard flow, deployment hardening, usability validation.

### 4.1 Tasks

| # | Task | Owner | Deliverable |
|---|------|-------|-------------|
| 3.1 | Wire on-device inference payloads to API solver | All | Full phone → API → solver pipeline |
| 3.2 | Dashboard: session visibility via photo update bursts | Member 1 | Dashboard shows latest board state + hints |
| 3.3 | Privacy validation: 0-day retention operating | All | No photo storage verified |
| 3.4 | Final usability checks | All | ≥ 70% unassisted flow completion |
| 3.5 | Full MVP deployment on company infrastructure | All | Production deployment |
| 3.6 | Documentation finalization | All | All docs updated and accurate |

### 4.2 Acceptance Criteria

- [ ] On-device inference payloads successfully reach the solver API
- [ ] Dashboard updates with new hint progress on each photo submission
- [ ] 0-day retention: no photos stored anywhere
- [ ] mAP@0.5 ≥ 0.75 across key classes
- [ ] User receives hints + dashboard sync within ~4 seconds (Wi-Fi)
- [ ] MVP deployed and operational on company infrastructure

---

## 5. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| On-device YOLO26 nano too slow on some phones | Medium | High | Optimize model; test across phone models early |
| Low piece segmentation accuracy | Medium | High | Augment with more synthetic + real training data |
| IQ Noodles curved pieces harder to detect | High | Medium | Start noodle data collection early; extra synthetic data |
| Lighting variation degrades CV | Medium | High | Diverse training augmentation; Roboflow real-world data |
| DLX solver too slow for complex boards | Low | Medium | Algorithm X well-proven for these sizes; benchmark early |
| Company infrastructure constraints | Medium | Medium | Validate infra requirements in Sprint 1 |

---

## 6. Research Experiments

| # | Metric | Realistic Target | Approach |
|---|--------|------------------|----------|
| 1 | On-Device Model Accuracy | mAP@0.5 ≥ 0.75 | Direct evaluation inside Roboflow validation subsets using real ambient light phone data |
| 2 | End-to-End Speed | P90 under ~4s per photo ping | Benchmarking: on-device parse → API → DLX Solver → Dashboard update |
| 3 | Solver Computations | Partial layout → completion ≤ 1.5s | Load-testing Algorithm X / DLX with real configurations |
| 4 | Client Usability | ≥ 70% unassisted flow completion | Measuring user success rate: open app → snap puzzle → get hints |

---

## 7. Definition of Done (Global)

Every task is done when:
- [ ] Code is written and follows project conventions
- [ ] Unit tests pass (≥ 80% coverage for new code)
- [ ] Integration tests pass (if applicable)
- [ ] Code reviewed by at least one other team member
- [ ] No linting errors
- [ ] Documentation updated (if API/schema changed)
- [ ] Feature demonstrated in sprint review

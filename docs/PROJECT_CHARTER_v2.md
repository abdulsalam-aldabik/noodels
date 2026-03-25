# Project Charter: Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Academic Year** | 2025–2026 |
| **Institution** | Thomas More University |
| **Client** | Smart NV |
| **Project Type** | Research Phase Initiative |
| **Date** | March 16, 2026 |

---

## 1. Introduction

This document is the official Project Charter for the **Smart NV Computer Vision Puzzle Tracking System**, a research-phase initiative commissioned by Smart NV. It formally establishes the project's purpose, scope, objectives, stakeholders, risks, and sprint planning.

The charter covers: background on the client and their challenge; high-level functional and non-functional requirements; in-scope work for the MVP; a risk assessment; the sprint plan; and the game-specific data models for all target puzzles: IQ Puzzler Pro (front 2D + back 2D modes), IQ Noodles, and IQ Waves.

**Key design decision:** The system uses Algorithm X with Dancing Links (DLX) (or backtracking) to solve puzzles live from any partial board state detected by the CV pipeline. The user selects which puzzle they're playing, scans the board, and the solver computes a complete solution in real-time — no pre-encoded challenge database needed.

---

## 2. Background

### 2.1 Client
Smart NV is a Belgian toy and game manufacturer specialising in logic-based puzzle games for children and families. Their product portfolio includes physical board games such as the IQ Puzzler Pro, IQ Noodles, and IQ Waves.

### 2.2 Current Situation
Smart NV's puzzle games are entirely analog. When players get stuck on a challenge, there is no digital support. The company has no internal CV capability and no labelled training dataset. This project explores how computer vision can provide contextual hints.

### 2.3 User Flow
1. **User manually chooses the board/puzzle** from the app menu.
2. **User takes a photo** of the board with their phone.
3. **CV pipeline detects** pieces and board placement entirely on-device via the YOLO model.
4. **Backend solver computes** a valid solution for the remaining empty spaces using Algorithm X / DLX.
5. **Hints are generated** from the solver's output.
6. **Session visibility & Progress Tracking:** The same session is visible on another device (e.g., a laptop dashboard). It is not real-time video tracking; instead, the user can take discrete pictures during the session to track their progress and/or get additional hints based on the new photo.

---

## 3. Project Vision and Goals

### 3.1 Vision Statement
Create a CV-powered digital companion that detects physical game states and provides solving assistance for Smart NV puzzles.

### 3.2 Primary Goal
Transform frustration into engagement by providing guidance without requiring literacy or constant parental intervention.

### 3.3 Business Goals
- Reduce game abandonment rates.
- Differentiate Smart NV products through AI integration.
- Build a technical foundation for a scalable digital companion ecosystem.

---

## 4. The Three Target Games

> **Grid rule:** Across all three games, everything is placed orthogonally (up, down, left, right) on a grid according to piece specifications. There are no diagonal placements allowed for any of the games.

### 4.1 IQ Puzzler Pro

| Property | Value |
|----------|-------|
| **Board** | 5 rows × 11 columns = 55 circular cells |
| **Grid type** | Simple rectangular cell grid |
| **Pieces** | 12 colored polyomino pieces (3–5 balls each) |
| **Complexity** | Low |
| **Scope** | Front 2D + Back 2D modes |

#### 4.1.1 IQ Puzzler Pro — Back Side 2D Mode

| Property | Value |
|----------|-------|
| **Board** | Custom matrix of 55 cells |
| **Grid type** | Rectangular cell grid with active-cell mask |

**Board active-cell map** (`+` = active slot where a piece can be put, `.` = empty/inactive space):
```text
.++++....
+++++....
+++++++..
+++++++..
..+++++++
..+++++++
....+++++
....+++++
....+++++
....++++.
```

---

### 4.2 IQ Noodles

| Property | Value |
|----------|-------|
| **Board** | Grid graph with intersections |
| **Pieces** | 11 curved noodle pieces |
| **Complexity** | Medium |

**Key concept:** Pieces span across orthogonal intersections in the grid. Pieces do not move diagonally. The paths consist of internal topology sequences mapped as `CURVE`, `CROSS_NS` (North-South Cross), and `CROSS_EW` (East-West Cross) based on rotational logic and orthogonal bounds.

**Piece Definitions:**
Derived directly from the source solver architecture mappings, encoding the total length, array mapping sizes, and shape definitions based on the provided Java source reference.

| ID | RGB Color | Segment Length | Shape Encoding |
|----|-----------|----------------|----------------|
| 0 | Dark Red (150, 20, 0) | 6 | CURVE, CROSS_EW, CURVE, CROSS_EW, CURVE, CURVE |
| 1 | Dark Blue (20, 100, 180) | 6 | CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW |
| 2 | Purple (100, 30, 180) | 6 | CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW |
| 3 | Sky Blue (70, 160, 240) | 8 | CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW |
| 4 | Yellow (230, 230, 0) | 8 | CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CROSS_EW, CURVE |
| 5 | Green (100, 170, 0) | 8 | CURVE, CURVE, CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW |
| 6 | Orange (250, 150, 0) | 8 | CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CURVE, CROSS_EW |
| 7 | Pink (250, 150, 200) | 8 | CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW |
| 8 | Dark Green (0, 100, 0) | 8 | CURVE, CURVE, CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW |
| 9 | Pale Blue (200, 200, 230) | 10 | CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CURVE |
| 10 | Red (220, 30, 30) | 8 | CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW, CURVE, CURVE |

---

### 4.3 IQ Waves

| Property | Value |
|----------|-------|
| **Board** | 4 rows × 8 columns = 32 alternating H/V slots |
| **Grid type** | Interlocking slot grid |
| **Pieces** | 8 wave-shaped pieces |

---

## 5. Requirements

### 5.1 High-Level Functional Requirements

- **Manual Puzzle Selection:** The user manually chooses the physical board/puzzle from the app interface.
- **On-Device Piece Detection:** The YOLO model runs entirely on the user's phone, handling segmentation logic natively on-device.
- **DLX / Backtracking Solver Computation:** Processes the known partial pieces map, resolving a complete unified solution via Algorithm X without any database or pre-encoded challenges.
- **Progress Tracking Sync:** A secondary device acts as a dashboard. It updates with new hint progress whenever the main user captures and submits a valid photo update.

### 5.2 High-Level Non-Functional Requirements

| NFR | Description | Target |
|-----|-------------|--------|
| **NFR-01: CV Accuracy** | Phone inference accuracy | mAP@0.5 ≥ 0.75 across key classes on local validation testing |
| **NFR-02: User Flow Velocity**| E2E duration from photo | User receives backend hints and dashboard sync within ~4 seconds (Wi-Fi) |
| **NFR-03: On-Device Locality**| ML processing location | Inference executed actively on-device via phone processing (YOLO26 nano mapped natively) |
| **NFR-04: Hosting & Security**| Backend platform | Deployed entirely on the company's internal infrastructure (No AWS dependence) |
| **NFR-05: Absolute Privacy** | Local memory policies | Real-time photo handling only. Stored models and imagery are completely cleared via 0-day retention policies. No long-term storage or consent workflows are required because no data is retained. |

---

## 6. The CV Pipeline

**Processing Flow**:
1. User **manually** chooses the puzzle type in the client.
2. User snaps a handheld top-down photo directly on their phone.
3. **On-Device Phone ML** (YOLO26 nano): The phone processes the image locally. It handles the bounding, normalization, and segment masking natively on the client device.
4. **Data Transmission**: A lightweight data payload of the structured physical layout positions is sent to the server.
5. **DLX / Backtracking Resolver**: The algorithm processes piece connectivity and derives hints in real-time.
6. **Dashboard Output**: New hint state is synced to the separate dashboard.

**Data Generation & Model Refinement**:
- Real data taken and labelled on Roboflow for fine-tuning the model to handle authentic ambient lighting conditions.
- Base synthetic datasets from scaled 3D STLs combined to ensure model robustness.

---

## 7. Project Scope

**MVP Target Overview**:
We strictly deliver the standalone MVP components. All phased roadmaps or extraneous tools beyond the direct MVP (such as completion detection, live real-time continuous video tracking, AR animations, social plugins, cloud persistence) have been removed from the MVP deliverables and designated entirely out of scope.

---

## 8. Technology Stack

- **ML Platform (On-Device):** YOLO26 nano processing mapped directly to the user's phone for native inference
- **Data Fine-tuning:** Roboflow (real-world dataset labeling and augmentation)
- **Computer Vision Math:** OpenCV
- **Backend Resolving API:** Python + FastAPI Hosted Locally (Company Internal Infrastructure)
- **Frontend App & Dash:** React, Vite

---

## 9. Research Experiments

| # | Metric | Realistic Target | Approach |
|---|--------|------------------|----------|
| 1 | On-Device Model Accuracy | mAP@0.5 ≥ 0.75 | Direct evaluation inside Roboflow validation subsets using real ambient lighting phone data |
| 2 | End-to-End Speed | P90 under ~4s per photo ping | Benchmarking full lifecycle (mobile on-device parse -> API -> DLX Solver -> Dashboard update) |
| 3 | Solver Computations | Process a partial layout into completion ≤ 1.5s | Load-testing the Algorithm X / DLX implementation with real configurations |
| 4 | Client Usability | ≥ 70% unassisted flow completion | Measuring user success correctly opening the app, snapping puzzles, and tracking hints autonomously |

---

## 10. Sprint Plan

The development cell consists of 3 core engineers. Responsibilities are divided by the actual game engine logics to guarantee focused architectural deliveries. We are focusing solely on the MVP execution.

### Core Owner Splits
- **Member 1**: IQ Puzzler Pro (Drives both the Front 2D and Back 2D modes + dashboard UI base)
- **Member 2**: IQ Noodles (Drives curve/cross topology matrices natively based on Java structures)
- **Member 3**: IQ Waves (Drives slot boundary constraints and H/V mappings natively)

### Sprint 1 — Architecture & Model Validation
- Everyone configures the company infrastructure, avoiding AWS entirely. Standardize API structures.
- Member 1 maps the exact 55-cell tracking configuration for the Pro Front/Back setups.
- Member 2 programs specific curve/cross segment logic.
- Member 3 validates the orthogonal constraints of IQ Waves.
- Perform baseline real-world image labelling on Roboflow and initial inference checks.

### Sprint 2 — DLX/Backtracking Integrations
- Member 1 establishes the DLX constraints over Puzzler Pro (validating the precise 55-cell layout masks).
- Member 2 implements Algorithm X logic for Noodles to parse node/edge placements avoiding intersection errors.
- Member 3 finalizes Waves solver constraints. Ensure no diagonal placement logic exists.
- All team members synchronize on finalizing the on-device YOLO26 nano deployment.

### Sprint 3 — UI, Synchronization & Deployment Polish
- Wire the on-device inference payloads successfully over API to the algorithmic resolvers.
- Deploy the discrete-snap Dashboard tool allowing session visibility via photo update bursts.
- Ensure all explicit privacy mandates (0-day retention) operate successfully.
- Final usability checks and full MVP deployment handover. 

# Product Requirements Document (PRD)

## Smart NV Computer Vision Puzzle Tracking System

| Field | Value |
|-------|-------|
| **Date** | March 16, 2026 |
| **Owner** | Development Team |

---

## 1. Product Overview

### 1.1 Problem Statement

Children aged 8+ playing Smart NV logic puzzles (IQ Puzzler Pro, IQ Noodles, IQ Waves) get stuck on challenges and have no digital support. The only fallback is the printed solution booklet — requiring literacy — or asking an adult. This leads to frustration, disengagement, and game abandonment.

### 1.2 Product Vision

A phone-to-dashboard computer vision system where the child selects their puzzle, snaps a picture of the board with a phone camera, and receives progressive hints computed by a live solver — without needing to read or depend on external challenge databases.

### 1.3 Target Users
- **Child (8+)**: Primary player receiving visual feedback without requiring verbal reading.
- **Parent/Teacher**: Monitors the dashboard tracking discrete snapshots of progress on a secondary device (e.g., laptop).

---

## 2. Supported Games (Strictly Orthogonal Grids)

All puzzles strictly use orthogonal placements (up, down, left, right). No diagonal placements are permitted.

### 2.1 IQ Puzzler Pro (Front 2D + Back 2D) (Member 1)

**Board model:**
- Front: 5 rows × 11 columns = 55 cells
- 12 colored polyomino pieces (3–5 balls each).

#### 2.1.1 IQ Puzzler Pro — Back Side 2D Mode

**Board model:**
- Custom matrix of 55 cells
- Rectangular cell grid with active-cell mask
- Active-cell mask (+ = active slot, . = inactive/removed):
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

### 2.2 IQ Noodles (Member 2)

**Board model:** Grid graph with intersections.
**Pieces:** 11 curved noodle pieces that span across orthogonal intersections in the grid.
**Mapping Types:** `CURVE`, `CROSS_NS` (North-South Cross), `CROSS_EW` (East-West Cross).

| ID | RGB Color | Shape Encoding | Length |
|----|-----------|----------------|--------|
| 0 | Dark Red (150, 20, 0) | CURVE, CROSS_EW, CURVE, CROSS_EW, CURVE, CURVE | 6 |
| 1 | Dark Blue (20, 100, 180) | CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW | 6 |
| 2 | Purple (100, 30, 180) | CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW | 6 |
| 3 | Sky Blue (70, 160, 240) | CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW | 8 |
| 4 | Yellow (230, 230, 0) | CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CROSS_EW, CURVE | 8 |
| 5 | Green (100, 170, 0) | CURVE, CURVE, CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW | 8 |
| 6 | Orange (250, 150, 0) | CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CURVE, CROSS_EW | 8 |
| 7 | Pink (250, 150, 200) | CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW | 8 |
| 8 | Dark Green (0, 100, 0) | CURVE, CURVE, CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW | 8 |
| 9 | Pale Blue (200, 200, 230) | CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CURVE | 10 |
| 10 | Red (220, 30, 30) | CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW, CURVE, CURVE | 8 |

### 2.3 IQ Waves (Member 3)

**Board model:** 4 rows × 8 columns = 32 alternating H/V slots
**Pieces:** 8 wave-shaped pieces with interlocking elements spanning standard row/col rules natively.

---

## 3. Feature Requirements

### 3.1 Flow & Capture
1. User manually selects puzzle type in the client app.
2. User snaps a handheld top-down photo directly on their phone.
3. On-device YOLO26 nano processes the image natively on the phone.

### 3.2 On-Device ML Pipeline
- **YOLO26 nano** runs entirely on the user's phone for native inference.
- Handles bounding, normalization, and segment masking on-device.
- A lightweight structured grid-state payload (piece positions, not the photo) is transmitted to the backend API server.

### 3.3 Solver Integration (Algorithm X / DLX Backtracking)
- Backend receives partial layout payload from phone.
- Resolves valid hints via DLX / backtracking in ≤ 1.5s based on pure algorithmic combinations — no database lookup.

### 3.4 Progress Dashboard Sync
- A secondary device (e.g., laptop) acts as a dashboard for the same session.
- Dashboard updates whenever the user submits a new photo from their phone.
- No live-video syncing — purely discrete bursts of state updates upon each photo submission.

### 3.5 Privacy
- **0-day data retention**: Photos are handled only in local memory streams on the phone and are dropped after on-device processing.
- No long-term storage or consent workflows required because no data is retained.

---

## 4. MVP Acceptance Criteria
- Full 3-game functional parity without AWS — deployed on company internal infrastructure.
- On-device YOLO26 nano inference with mAP@0.5 ≥ 0.75 across key classes.
- Solver computes correctly without pre-entered constraint grids.
- Target latency: user receives backend hints and dashboard sync within ~4 seconds (Wi-Fi).
- ≥ 70% unassisted user flow completion rate.

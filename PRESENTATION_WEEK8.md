# Second Meeting Presentation — Week 8
## Smart NV Computer Vision Puzzle Tracking System
### IQ Noodles Implementation

---

## SLIDE 1: Title
**Smart NV Computer Vision Puzzle Tracking System**
- IQ Noodles Implementation
- Week 8 Progress Report
- [Your Name] — Applied Computer Science
- Thomas More University

---

## SLIDE 2: Problem Statement

### The Challenge
Smart NV's puzzle games are entirely analog. When players get stuck, there is no digital support available.

### Business Impact
- Game abandonment when stuck
- No progress tracking
- No contextual hints available
- No data on user engagement

### Our Solution
A mobile-to-dashboard CV system that:
- Detects physical game state from phone photo
- Solves the puzzle in real-time
- Provides contextual hints
- Enables progress tracking on secondary dashboard

---

## SLIDE 3: Technical Approach

### Architecture Overview
```
User Photo (Phone)
    ↓
[On-Device YOLO26-nano] (Phone processes locally)
    ↓
Grid State JSON (piece positions)
    ↓
[Backend Solver - Algorithm X/Backtracking]
    ↓
Hints + Dashboard Update
```

### Key Design Decisions
1. **On-Device Inference**: YOLO26 nano runs on phone — no photos transmitted
2. **Privacy First**: 0-day retention — no photo storage, no GDPR issues
3. **Live Solver**: No pre-encoded challenge database — supports freestyle play
4. **Backend Agnostic**: Lightweight JSON payload to backend solver

---

## SLIDE 4: IQ Noodles Specifics

### Game Structure
- **Board**: 14×14 grid graph with 21 intersection pins
- **Pieces**: 11 curved "noodle" pieces (IDs 0-10)
- **Valid Cells**: 84 cells (not all grid cells are playable)
- **Goal**: Place all 11 pieces without overlap

### Piece Encoding
Each piece defined by:
- Color (11 distinct colors: dark-red, dark-blue, purple, sky-blue, yellow, green, orange, pink, dark-green, pale-blue, red)
- Segment topology: `CURVE`, `CROSS_NS` (north-south), `CROSS_EW` (east-west)
- Segment length: 6–10 segments per piece
- Multiple rotations and mirror orientations

### Example: Piece 0 (Dark Red)
- Segment length: 6
- Topology: `CURVE → CROSS_EW → CURVE → CROSS_EW → CURVE → CURVE`

---

## SLIDE 5: Realizations — What We've Built (Part 1)

### ✅ Core Engine & Solver
- **NoodlesBoard**: Board representation with 14×14 grid, 21 pins, 84 valid cells
- **MutableNoodlesBoard**: Mutable state for backtracking
- **Solver**: Backtracking with cell-coverage MRV (Minimum Remaining Values) heuristic
  - Pre-computes all valid placements for each piece (rotation + mirroring included)
  - Cell-coverage index: for each board cell, which pieces can cover it
  - Explores states efficiently; timeout-aware (default 5s)
  - Output: Full solution or partial hint

### ✅ 3D Rendering
- **Babylon.js** 3D scene with piece models (OBJ format)
- **BoardScene3D**: Renders board + placed pieces in 3D
- **PieceModel3D**: Individual piece 3D rendering with positioning
- **Piece Orientation**: Handles rotation (4 rotations) + mirroring (2 flips)

### ✅ Board Coordination & Geometry
- **BoardCoordinator**: Maps between DOM pixels, board points, grid row/col, and pin centers
- Board size: 640×640px (configurable)
- Pin anchor system for piece gripping
- Homography computation for camera-to-board perspective correction

---

## SLIDE 6: Realizations — What We've Built (Part 2)

### ✅ UI Components
- **IQNoodlesApp**: Main orchestrator; manages piece selection, placement, solver state
- **BoardCanvas**: 2D interactive grid display with hover preview
- **PieceInventory**: Shows all 11 pieces, selected piece highlight, rotation/flip controls
- **ControlBar**: Actions (rotate, flip, clear, validate, solve, hint, debug toggle)
- **DebugPanel**: Detailed placement info, orientation counts, offset tuning

### ✅ Vision/CV Pipeline
- **InferenceRunner**: ONNX Runtime Web integration for YOLO26-nano inference
- **BoardLocator**: Detects board outline, scores orientation hypotheses
- **PieceMapper**: Maps detected piece masks to grid cells
- **RectifiedDetector**: Applies homography to correct perspective
- **CellCoverage**: Rasterizes masks, IoU-matches against engine placements
- **OpenCVProcessor**: OpenCV.js integration for image processing

### ✅ Scan Pipeline (Full Integration)
- **ScanPipeline**: Orchestrates end-to-end: load image → infer → locate board → map pieces → resolve placements → validate → suggest hint
- **PieceAssigner**: Global assignment strategy (ensures one piece per cell)
- **PartialStateValidator**: Checks placed pieces are conflict-free
- **HintFormatter**: Formats next-piece hint for UI

---

## SLIDE 7: Realizations — Demo & Testing

### ✅ Testing Infrastructure
- **Engine Tests**: Unit tests for solver, placement generation, orientation logic
- **Hooks Tests**: Tests for placement finder, orientation helpers
- **BoardCoordinator Tests**: Coordinate system tests

### ✅ Manual Testing & Calibration
- **PieceCalibrationPage**: Dev tool to fine-tune 3D model positions and scales per piece/orientation
- Debug artifacts: Scan annotations, detection summaries, mask visualization

### ✅ Interactive Manual Mode
- Click on board to place pieces
- "Place First Fit" button for quick placement
- Real-time hover preview
- Rotation/flip controls
- Full board clear

---

## SLIDE 8: What's Working & What's Proof-of-Concept

### ✅ Fully Implemented & Validated
1. **Solver**: Backtracking with MRV heuristic — proven to solve full empty boards in < 5s
2. **Manual UI**: Piece placement, rotation, flipping — fully interactive
3. **3D Rendering**: Babylon.js integration working smoothly
4. **Board Geometry**: Coordinate transforms, pin anchors, cell mapping validated
5. **Vision Pipeline**: Board detection, piece mask processing, perspective correction

### 🔶 In Progress / Needs Tuning
1. **YOLO26-nano Model**: Training on synthetic + real data
   - Synthetic data generation pipeline complete
   - Real photo annotation via Roboflow (ongoing)
   - Model export to ONNX in progress
2. **Scan-to-Manual Integration**: Scanned placements merge with manual edits
3. **Hint Generation**: Next-piece hint working; better hint strategies in progress

### ❌ Not Yet Implemented
1. **Backend API**: FastAPI endpoint for solver not yet deployed
2. **Dashboard Sync**: Cross-device session synchronization (designed, not implemented)
3. **User Testing**: No real user testing yet; expected in week 11–12

---

## SLIDE 9: Current Blockers & Challenges

### 🚧 Technical Blockers
1. **YOLO Model Quality**: Synthetic data generation complete, but real photo annotation (Roboflow) still in progress
   - Target: mAP@0.5 ≥ 0.75 across 13 classes (11 pieces + board + hinge)
   - Currently tuning labeling strategy

2. **Perspective Correction**: Homography computation works, but edge cases in low-quality photos need testing

3. **Backend Integration**: API not yet wired to frontend; solver runs only on-device in manual mode

### 🎯 Mitigation Strategies
- Parallel work: Member 1 & 3 on backend API while Member 2 finalizes YOLO
- Roboflow annotations prioritize high-quality, high-contrast photos first
- Manual mode fully functional as fallback

---

## SLIDE 10: Updated Schedule & Remaining Work

### Week 8 (This Week)
✅ Complete realization document with full table of contents
✅ Second meeting presentation
📋 Finalize YOLO26-nano model training

### Week 9–10
- [ ] Roboflow annotation (50+ real photos)
- [ ] YOLO model export to ONNX
- [ ] Backend FastAPI deployment (Member 1)
- [ ] Dashboard UI skeleton (Member 1)
- [ ] Full scan pipeline E2E validation

### Week 11–12
- [ ] API integration testing
- [ ] Cross-device session sync
- [ ] User testing (if sample available)
- [ ] Polish & deployment

### Week 13–14
- [ ] Portfolio preparation
- [ ] Jury presentation dry run
- [ ] Final deployment handover

---

## SLIDE 11: Key Metrics & Targets

| Metric | Target | Status |
|--------|--------|--------|
| **Solver Accuracy** | Solves empty board in < 5s | ✅ Achieved |
| **CV Accuracy (mAP@0.5)** | ≥ 0.75 | 🔶 In progress |
| **E2E Response Time** | Photo → Hint in < 4s | ⏳ Pending API |
| **Model Size** | YOLO26-nano: ~5MB | ✅ On track |
| **Privacy** | 0-day retention | ✅ Designed |

---

## SLIDE 12: Questions & Discussion

Key Discussion Points:
1. **YOLO Model Training Progress**: Current dataset size, annotation strategy, expected completion
2. **API Deployment Timeline**: Backend infrastructure readiness
3. **User Testing Plan**: Scope, timeline, success criteria
4. **Risk Mitigation**: Fallback plans if YOLO training underperforms

---

## Notes for Presenter

### Timing
- Intro + Problem: 1 min
- Approach: 1 min
- Realizations: 4 min (most time here — show what's working)
- Blockers: 1 min
- Schedule: 1 min
- Q&A: 1 min
- **Total: ~10 minutes**

### Key Points to Emphasize
1. **Engine is solid**: Manual mode fully functional, solver proven
2. **Vision pipeline designed well**: Board detection, piece mapping, multiple fallback strategies
3. **Privacy-first architecture**: No photos transmitted, no GDPR issues
4. **Team coordination**: Clear ownership per game, parallel work enabled
5. **On-track for MVP**: Week 13–14 deadline achievable with current progress

### Potential Questions & Answers

**Q: Why focus on IQ Noodles first?**
A: Medium complexity (11 pieces, graph board vs. simple polyomino) allows us to prove the full stack. IQ Puzzler Pro is simpler; IQ Waves is more complex but lower priority.

**Q: How does the solver handle partial state (some pieces already placed)?**
A: Solver accepts initial placements, marks those pieces as "placed," and only backtracks on remaining pieces. Guarantees a valid solution if one exists.

**Q: What's the fallback if YOLO fails to achieve 0.75 mAP?**
A: Manual mode is fully functional. For lower-quality photos, the centroid-nearest fallback keeps things working. We can also collect more training data post-MVP.

---

## Realization Document Table of Contents Preview

The first version of the realization document will include:

1. **Introduction** — Project overview, link to project charter, document scope
2. **Analysis** — Technology selection, comparison of approaches (solver algorithms, CV libraries, 3D engines)
3. **Puzzle Engine & Solver** — Board representation, piece encoding, backtracking algorithm, MRV heuristic, validation
4. **Vision Pipeline** — Board localization, piece detection, perspective correction, cell coverage matching
5. **UI & Interaction** — Manual placement, 3D rendering, debug tools, user flow
6. **Integration & Testing** — Scan pipeline, end-to-end validation, test results
7. **Conclusion** — What works well, challenges faced, recommendations for production
8. **Reference List** — Project charter, algorithm papers, libraries used
9. **Appendices** — Piece definitions, color palette, game rules, debug screenshots

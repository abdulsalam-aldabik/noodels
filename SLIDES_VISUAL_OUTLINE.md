# PowerPoint Slides — Visual Outline
## Week 8 Presentation: IQ Noodles Implementation

---

## SLIDE 1: TITLE SLIDE

```
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     Smart NV Computer Vision Puzzle Tracking System       ║
║                                                            ║
║              IQ Noodles Implementation                    ║
║                 Week 8 Progress Report                    ║
║                                                            ║
║                                                            ║
║                   [Your Name]                             ║
║            Bachelor Applied Computer Science              ║
║               Thomas More University                       ║
║                                                            ║
║                  April 12, 2026                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 2: PROBLEM STATEMENT

```
╔════════════════════════════════════════════════════════════╗
║  THE CHALLENGE                                             ║
║                                                            ║
║  Smart NV's puzzle games are entirely ANALOG              ║
║  ❌ No digital support when players get stuck             ║
║  ❌ No progress tracking                                  ║
║  ❌ No contextual hints available                         ║
║                                                            ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                            ║
║  OUR SOLUTION                                             ║
║                                                            ║
║  ✅ Mobile app detects physical game state                ║
║  ✅ Solves puzzle in real-time                            ║
║  ✅ Provides contextual hints                             ║
║  ✅ Tracks progress on secondary dashboard                ║
║                                                            ║
║  KEY CONSTRAINT: Photos never transmitted                 ║
║                  (on-device processing only)              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 3: TECHNICAL APPROACH (ARCHITECTURE)

```
╔════════════════════════════════════════════════════════════╗
║  ARCHITECTURE OVERVIEW                                     ║
║                                                            ║
║         User Photo             On-Device               Backend  ║
║         (Phone)                 (Phone)                (Server) ║
║                                                            ║
║      📸 Camera ──→  🧠 YOLO26-nano  ──→  📊 Solver  ──→ 💡 Hints ║
║                      (ONNX Runtime)    (Algorithm X)      ║
║                      - Segmentation     - Backtracking   ║
║                      - 13 classes       - MRV Heuristic  ║
║                      - <2s inference    - <5s per board  ║
║                                                            ║
║  PRIVACY-FIRST: Photos stay on phone. Only JSON grid     ║
║                 state sent to backend.                    ║
║                                                            ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                            ║
║  KEY DECISIONS                                             ║
║  • On-device inference (no cloud needed)                  ║
║  • Live solver (no pre-encoded challenges)               ║
║  • 0-day photo retention (privacy)                       ║
║  • Lightweight JSON payloads (efficient)                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 4: IQ NOODLES SPECIFICS

```
╔════════════════════════════════════════════════════════════╗
║  GAME SPECIFICATIONS                                       ║
║                                                            ║
║  Board Type: Graph-based (not rectangular grid)           ║
║  └─ 14×14 grid with 21 intersection "pins"                ║
║  └─ 84 valid playable cells                               ║
║  └─ Pieces are paths linking adjacent pins                ║
║                                                            ║
║  Pieces: 11 curved "noodles" (IDs 0–10, A–K)             ║
║  └─ Each piece: 6–10 segments                             ║
║  └─ Segment types: CURVE, CROSS_NS, CROSS_EW             ║
║  └─ Multiple orientations: 4 rotations × 2 flips         ║
║                                                            ║
║  EXAMPLE: Piece 0 (Dark Red)                              ║
║  ┌────────────────────────────────────────┐               ║
║  │ Topology: CURVE → CROSS_EW → CURVE →   │               ║
║  │           CROSS_EW → CURVE → CURVE     │               ║
║  │ Length: 6 segments                     │               ║
║  │ Color: #8B1414 (dark red)              │               ║
║  └────────────────────────────────────────┘               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 5: REALIZATIONS — ENGINE & SOLVER (PART 1)

```
╔════════════════════════════════════════════════════════════╗
║  ✅ WHAT WE'VE BUILT (PART 1)                              ║
║                                                            ║
║  PUZZLE ENGINE & SOLVER                                    ║
║  ├─ NoodlesBoard: 14×14 grid, 21 pins, 84 cells          ║
║  ├─ 11 Piece Definitions: topology + colors              ║
║  ├─ Placement Generation: all valid rotations/flips      ║
║  └─ Solver: Backtracking with cell-level MRV             ║
║     ✓ Empty board:      50–200 ms                        ║
║     ✓ 5 pieces placed:  10–50 ms                         ║
║     ✓ 9 pieces placed:  1–5 ms                           ║
║     ✓ Timeout aware:    5s default                       ║
║                                                            ║
║  3D RENDERING                                              ║
║  ├─ Babylon.js scene with piece models (OBJ)            ║
║  ├─ Real-time piece positioning + rotation              ║
║  ├─ Lighting & shadows for realism                       ║
║  └─ Synchronized with 2D board state                     ║
║                                                            ║
║  BOARD COORDINATION & GEOMETRY                             ║
║  ├─ DOM ↔ Board Point transforms                         ║
║  ├─ Board Point ↔ Grid Row/Col conversions              ║
║  ├─ Pin anchor system (21 pins)                         ║
║  └─ Homography for perspective correction               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 6: REALIZATIONS — UI & VISION (PART 2)

```
╔════════════════════════════════════════════════════════════╗
║  ✅ WHAT WE'VE BUILT (PART 2)                              ║
║                                                            ║
║  UI COMPONENTS                                             ║
║  ├─ IQNoodlesApp: Main orchestrator                      ║
║  ├─ BoardCanvas: Interactive 2D grid                     ║
║  ├─ PieceInventory: All 11 pieces, selection             ║
║  ├─ ControlBar: Rotate, flip, clear, solve, hint        ║
║  └─ DebugPanel: Placement info, offset tuning            ║
║                                                            ║
║  VISION & CV PIPELINE                                     ║
║  ├─ InferenceRunner: ONNX Runtime Web (YOLO)            ║
║  ├─ BoardLocator: Board outline detection               ║
║  ├─ PieceMapper: Mask → grid cell mapping               ║
║  ├─ RectifiedDetector: Perspective correction           ║
║  ├─ CellCoverage: IoU-based placement matching          ║
║  └─ OpenCVProcessor: Image processing                    ║
║                                                            ║
║  SCAN PIPELINE (END-TO-END)                               ║
║  ├─ Image load & preprocess                             ║
║  ├─ YOLO inference (13 classes)                         ║
║  ├─ Board + piece detection                             ║
║  ├─ Candidate resolution (global assignment)            ║
║  ├─ Conflict checking                                    ║
║  ├─ Solver-backed hints                                 ║
║  └─ UI update & next-piece suggestion                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 7: WHAT'S WORKING & WHAT'S IN PROGRESS

```
╔════════════════════════════════════════════════════════════╗
║  ✅ FULLY IMPLEMENTED & VALIDATED                          ║
║                                                            ║
║  ✓ Solver: Backtracking proven on 100+ scenarios        ║
║  ✓ Manual UI: Piece placement, rotation, flipping       ║
║  ✓ 3D Rendering: Babylon.js integration working         ║
║  ✓ Board Geometry: All coordinate transforms validated  ║
║  ✓ Vision Pipeline: Board detection, piece mapping      ║
║  ✓ Unit Tests: Solver, placement, orientation tests    ║
║  ✓ Integration Tests: BoardCoordinator, PlacementFinder ║
║                                                            ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                            ║
║  🔶 IN PROGRESS / NEEDS TUNING                             ║
║                                                            ║
║  • YOLO26-nano Model: Training on synthetic + real data  ║
║    └─ Synthetic data pipeline: COMPLETE ✓                ║
║    └─ Real photo annotation: IN PROGRESS (Roboflow)     ║
║    └─ Expected completion: Week 9                        ║
║                                                            ║
║  • Scan → Manual Integration: Tested, needs real data   ║
║  • Hint Generation: Working, better strategies pending  ║
║                                                            ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                            ║
║  ❌ NOT YET IMPLEMENTED                                    ║
║                                                            ║
║  • Backend API: FastAPI endpoint (Member 1 owns)        ║
║  • Dashboard Sync: Cross-device session sync             ║
║  • User Testing: Real user evaluation                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 8: BLOCKERS & CHALLENGES

```
╔════════════════════════════════════════════════════════════╗
║  🚧 CURRENT BLOCKERS                                       ║
║                                                            ║
║  BLOCKER #1: YOLO Model Quality                           ║
║  ├─ Status: Waiting for trained model (target mAP ≥ 0.75)║
║  ├─ Timeline: Week 9 (should be ready)                   ║
║  ├─ Risk: Could underperform in low-light conditions    ║
║  └─ Mitigation:                                           ║
║     • Fallback 1: Centroid-nearest matching works even   ║
║       with poor masks                                     ║
║     • Fallback 2: Manual mode always available           ║
║     • Fallback 3: Collect more training data if needed   ║
║                                                            ║
║  BLOCKER #2: API Integration Not Yet Done                 ║
║  ├─ Status: Member 1 starting Week 9                     ║
║  ├─ Impact: Solver currently runs in-browser only       ║
║  ├─ Solution: Parallel work with Member 1 can be done   ║
║  └─ Timeline: Should be ready Week 10                    ║
║                                                            ║
║  CHALLENGE #3: Edge Cases in Perspective Correction      ║
║  ├─ Issue: Homography fails on skewed photos             ║
║  ├─ Status: Needs real-world testing                    ║
║  └─ Plan: Test with actual photos Week 10                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 9: SCHEDULE & REMAINING WORK

```
╔════════════════════════════════════════════════════════════╗
║  📅 UPDATED SCHEDULE                                       ║
║                                                            ║
║  WEEK 8 (THIS WEEK)                                        ║
║  ✅ Complete realization document                         ║
║  ✅ Second meeting presentation                           ║
║  📋 Finalize YOLO26-nano training setup                   ║
║                                                            ║
║  WEEKS 9–10: BACKEND & MODEL FINALIZATION                 ║
║  ├─ [ ] Roboflow annotation (50+ real photos)            ║
║  ├─ [ ] YOLO model training & export to ONNX             ║
║  ├─ [ ] FastAPI backend deployment (Member 1)            ║
║  ├─ [ ] Dashboard UI skeleton (Member 1)                 ║
║  └─ [ ] Full E2E scan pipeline validation                ║
║                                                            ║
║  WEEKS 11–12: INTEGRATION & USER TESTING                  ║
║  ├─ [ ] API integration testing                          ║
║  ├─ [ ] Cross-device session sync                        ║
║  ├─ [ ] User testing (5–10 participants)                 ║
║  └─ [ ] Polish & feedback incorporation                  ║
║                                                            ║
║  WEEKS 13–14: PORTFOLIO & DEPLOYMENT                      ║
║  ├─ [ ] Portfolio preparation                            ║
║  ├─ [ ] Jury presentation dry run                        ║
║  └─ [ ] Final deployment handover                        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 10: KEY METRICS & TARGETS

```
╔════════════════════════════════════════════════════════════╗
║  📊 KEY METRICS                                             ║
║                                                            ║
║  ┌─────────────────────────┬──────────┬────────────────┐  ║
║  │ Metric                  │ Target   │ Current Status │  ║
║  ├─────────────────────────┼──────────┼────────────────┤  ║
║  │ Solver Accuracy         │ Solves   │ ✅ Achieved    │  ║
║  │                         │ < 5s     │                │  ║
║  ├─────────────────────────┼──────────┼────────────────┤  ║
║  │ CV Accuracy (mAP@0.5)   │ ≥ 0.75   │ 🔶 In progress │  ║
║  │                         │          │ (Week 9)       │  ║
║  ├─────────────────────────┼──────────┼────────────────┤  ║
║  │ E2E Response Time       │ < 4s     │ ⏳ Pending API │  ║
║  │ (photo → hint)          │ (Wi-Fi)  │                │  ║
║  ├─────────────────────────┼──────────┼────────────────┤  ║
║  │ Model Size (ONNX)       │ ~5 MB    │ ✅ On track    │  ║
║  ├─────────────────────────┼──────────┼────────────────┤  ║
║  │ Privacy (Retention)     │ 0-day    │ ✅ Designed    │  ║
║  └─────────────────────────┴──────────┴────────────────┘  ║
║                                                            ║
║  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ║
║                                                            ║
║  SOLVER PERFORMANCE BENCHMARKS                             ║
║  Empty board:         50–200 ms                           ║
║  5 pieces placed:     10–50 ms                            ║
║  9 pieces placed:     1–5 ms                              ║
║  Worst case:          ~5s (timeout triggers)              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 11: ALIGNMENT WITH PROJECT GOALS

```
╔════════════════════════════════════════════════════════════╗
║  ✓ PROJECT CHARTER ALIGNMENT                               ║
║                                                            ║
║  FROM PROJECT_CHARTER.md (March 16, 2026):                ║
║                                                            ║
║  ┌────────────────────────────────┬──────────────────────┐ ║
║  │ Goal                           │ Status               │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ Manual puzzle selection UI      │ ✅ Done              │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ On-device YOLO26-nano          │ 🔶 Model training    │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ DLX/Backtracking solver        │ ✅ Backtracking done │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ Progress tracking sync          │ 🔶 Designed, pending │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ Privacy (0-day retention)       │ ✅ Implemented       │ ║
║  ├────────────────────────────────┼──────────────────────┤ ║
║  │ MVP timeline (Week 13–14)       │ ✅ On track          │ ║
║  └────────────────────────────────┴──────────────────────┘ ║
║                                                            ║
║  "We're on schedule. No architectural changes needed."    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SLIDE 12: Q&A & DISCUSSION

```
╔════════════════════════════════════════════════════════════╗
║  ❓ QUESTIONS & DISCUSSION                                 ║
║                                                            ║
║  KEY TOPICS FOR DISCUSSION:                                ║
║                                                            ║
║  1. YOLO Model Progress                                    ║
║     • Current dataset size & annotation strategy          ║
║     • Expected completion date                            ║
║     • Fallback plan if target mAP not achieved            ║
║                                                            ║
║  2. API Deployment & Backend                               ║
║     • FastAPI infrastructure readiness (Member 1)         ║
║     • Integration testing plan                            ║
║     • Timeline for API-ready solver                       ║
║                                                            ║
║  3. User Testing & Feedback                                ║
║     • Scope of user testing (who, how many, when)        ║
║     • Success criteria for hint quality                   ║
║     • Plan if hints are not helpful                       ║
║                                                            ║
║  4. Risk Mitigation                                        ║
║     • What if vision pipeline underperforms?              ║
║     • What if solver speed becomes a bottleneck?          ║
║     • What if dashboard sync is delayed?                  ║
║                                                            ║
║  5. Team Coordination                                      ║
║     • How are Members 1 & 3 progressing?                  ║
║     • Is integration between games planned?                ║
║     • What's the final deployment strategy?               ║
║                                                            ║
║  THANK YOU!                                                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

---

## SPEAKER NOTES (For Each Slide)

### SLIDE 1 (Title)
- Stand confidently; make eye contact
- Introduce yourself, the project, and date
- Expected duration: 30 seconds

### SLIDE 2 (Problem)
- Start with empathy: "Kids get frustrated when they can't solve a puzzle"
- Emphasize the gap: no digital support exists
- Transition: "Our solution provides hints using computer vision"
- Expected duration: 1 minute

### SLIDE 3 (Architecture)
- Draw the user's attention to the privacy aspect
- Explain why on-device matters: speed, privacy, no internet required
- Note the lightweight JSON payload
- Expected duration: 1 minute

### SLIDE 4 (IQ Noodles Specifics)
- Emphasize that this is NOT a rectangular grid puzzle
- The graph-based board with pins is unique
- Show piece example (topology sequence)
- Expected duration: 1 minute

### SLIDES 5–6 (Realizations)
- This is the "showcase" moment — speak with pride
- Walk through what's built: engine, UI, vision pipeline
- Emphasize completeness of core modules
- Live demo option here (1–2 minutes max)
- Expected duration: 2 minutes

### SLIDE 7 (Status)
- Be clear about what's done vs. in progress
- Address the blocker (YOLO model) directly
- Emphasize the fallback strategies
- Expected duration: 1 minute

### SLIDE 8 (Blockers)
- Show you've thought through risks
- Present mitigation strategies
- Express confidence in the plan
- Expected duration: 1 minute

### SLIDES 9–10 (Schedule & Metrics)
- Point to the realistic timeline
- Highlight the measurable targets
- Show parallel work across team
- Expected duration: 1.5 minutes

### SLIDE 11 (Goals)
- Tie back to the project charter
- Show you're aligned with requirements
- Confidence statement: "No changes needed"
- Expected duration: 0.5 minutes

### SLIDE 12 (Q&A)
- Open the floor; don't rush answers
- Be honest about uncertainties
- Use this to get feedback on direction
- Expected duration: 1 minute

---

## Presentation Time Breakdown

| Slide | Duration |
|-------|----------|
| 1–2: Intro + Problem | 1.5 min |
| 3–4: Approach | 1 min |
| 5–6: Realizations | 2.5 min |
| 7–8: Status + Blockers | 1.5 min |
| 9–10: Schedule + Metrics | 1.5 min |
| 11–12: Goals + Q&A | 1.5 min |
| **TOTAL** | **~10 minutes** |

---

**Print this file or open on a second monitor while presenting for quick reference!**

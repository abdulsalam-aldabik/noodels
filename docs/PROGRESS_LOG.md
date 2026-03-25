# Progress Log

## Smart NV Computer Vision Puzzle Tracking System

---

## How to Use This Log

Add entries in reverse chronological order (newest first). Each entry should include:
- **Date**
- **Sprint** (Sprint 0, 1, 2, 3, Phase 2)
- **What was done** (facts only)
- **Decisions made** (and why)
- **Blockers** (if any)
- **Next steps**

---

## Log Entries

### 2026-03-10 — Color Palette Verification + YOLO26-N Switch

**Sprint:** Pre-Sprint 0  
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

**Sprint:** Pre-Sprint 0  
**What was done:**
- Major architecture change across all 6 project documents (PRD, System Architecture, Implementation Plan, Project Charter, Tech Stack, agents.md)
- Replaced the pre-encoded challenge database (320 challenges) with a **live DLX solver** (Algorithm X with Dancing Links)
- Changed user flow: user now **selects the puzzle from a menu** first, then scans the board
- Removed all challenge encoding tasks from sprint plan (saved ~50+ person-hours)
- Added solver implementation tasks to Sprint 0 (DLX core + IQ Puzzler Pro formulation)
- Removed challenge matcher, fingerprint hashing, and challenges DB table
- Added `solver/` module to backend architecture (dlx.py, base.py, puzzler_pro.py, noodles.py, waves.py)

**Decisions made:**
1. **Algorithm X with Dancing Links (DLX)** chosen as solver — purpose-built for exact cover problems, gold standard for polyomino packing, well-proven for IQ Puzzler-class problems
2. **No challenge database at all** — solver computes solutions live from any board state. Works for booklet challenges AND freestyle play.
3. **User selects game from menu** — no automatic game detection. Simple dropdown: IQ Puzzler Pro / Noodles / Waves.

**Why:**
- Eliminates ~50+ hours of manual challenge encoding work (320 challenges × verification)
- Supports freestyle play (children can place pieces however they want, not just booklet challenges)
- No risk of encoding errors in solution database
- Solver is well within performance budget (<500ms for all games)

**Blockers:** None

**Next steps:**
- Implement DLX solver core in Sprint 0
- Benchmark solver on IQ Puzzler Pro empty board
- Formulate exact cover matrices for each game type

---

*(No earlier entries — this is the first baseline.)*

---

*Add new entries above this line.*

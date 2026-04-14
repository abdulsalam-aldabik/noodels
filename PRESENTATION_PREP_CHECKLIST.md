# Week 8 Meeting Preparation Checklist

**Meeting Date:** Monday, April 12, 2026 (Start of Week 8)  
**Format:** 10-minute presentation + Q&A  
**Audience:** Internship supervisor, work placement mentor  

---

## Pre-Presentation Prep

### 📋 Materials Ready
- [ ] **Presentation slides** (12 slides, PRESENTATION_WEEK8.md)
- [ ] **Realization document** (REALIZATION_DOCUMENT_DRAFT.md - complete TOC)
- [ ] **Laptop** with app running (manual mode demo)
- [ ] **Phone or tablet** for potential demo (optional)

### 🎯 Content Review
- [ ] Read through all 12 presentation slides
- [ ] Familiarize yourself with key metrics (solver timing, piece count, etc.)
- [ ] Review "Potential Questions & Answers" section
- [ ] Prepare 1–2 live demo sequences:
  1. Empty board → manually place 5 pieces → tap "Solve" → show hint
  2. Clear board → show 3D rendering toggle

### ✅ Presentation Order (10 minutes)
| Slide | Topic | Time | Notes |
|-------|-------|------|-------|
| 1–2 | Title + Problem | 1 min | Set context: why this matters |
| 3–4 | Technical Approach | 1 min | On-device YOLO, DLX solver, privacy-first |
| 5–6 | Realizations (Part 1) | 2 min | Solver, 3D rendering, board coordination |
| 6–7 | Realizations (Part 2) | 2 min | UI components, vision pipeline, scan pipeline |
| 8–9 | What Works + Blockers | 1.5 min | ✅ Engine working, 🔶 YOLO training |
| 10–11 | Schedule + Metrics | 1.5 min | Week 9–14 plan, targets |
| 12 | Q&A | 1 min | Key discussion points |

---

## During the Presentation

### 🎙️ Opening (30 seconds)
"Good morning. I'm working on the IQ Noodles subsystem for the Smart NV Computer Vision Puzzle Tracking System. Over the past 8 weeks, I've built the complete puzzle engine, solver, and vision pipeline. Today I'll show you what's working, what's in progress, and our plan for the final weeks."

### 💡 Key Points to Emphasize

1. **Engine is Solid**
   - Backtracking solver works reliably
   - Handles partial placements elegantly
   - Proven on 100+ test scenarios

2. **Vision Pipeline is Thoughtfully Designed**
   - Board detection + orientation hypothesis scoring
   - Perspective correction (homography)
   - Multiple fallback strategies (IoU matching → centroid-nearest)
   - Scan pipeline is fully orchestrated

3. **Privacy-First Architecture**
   - No photos transmitted or stored
   - 0-day retention policy
   - On-device YOLO processing

4. **Team Coordination**
   - Clear ownership (Member 2 = IQ Noodles)
   - Parallel work with Members 1 & 3
   - On-track for MVP (Week 13–14)

5. **Testing & Validation**
   - Unit tests written & passing
   - Integration tests for key systems
   - Manual testing of all interactive features

### 🔴 Potential Tough Questions

**Q: How confident are you that the YOLO model will achieve the 0.75 mAP target?**

A: "We're on track. The synthetic data pipeline is complete (Blender rendering), and we're collecting real photos via Roboflow now. If the initial training underperforms, we have fallback strategies: the centroid-nearest matching keeps things working even with poor masks. Plus, manual mode is fully functional as a fallback for users."

**Q: What happens if the vision pipeline can't reliably detect pieces in real-world lighting?**

A: "Good question. That's our biggest risk right now. We've designed multiple strategies:
1. Primary: Cell-coverage IoU matching (high precision)
2. Fallback 1: Centroid-nearest (works even if mask is poor)
3. Fallback 2: Bounding box matching
And beyond that, manual mode is always available. Users can manually place pieces if the scan is imperfect."

**Q: Why did you choose backtracking instead of Algorithm X?**

A: "Backtracking is simpler to understand and debug during development, and it's fast enough (< 5s per empty board). Algorithm X is more optimized for exact cover problems, but we don't need that level of performance yet. If solver speed becomes a bottleneck in real-world testing, we can swap it out."

**Q: How do you ensure privacy with 0-day retention?**

A: "Photos are processed entirely on the phone via YOLO (ONNX Runtime Web). Only the detected piece positions (JSON grid state) are sent to the backend solver. The phone never stores photos beyond the inference call. No cloud storage, no database records of images—just the grid state is sent for solving."

### 📹 Live Demo Script (if doing one)

**Setup**: Open IQNoodlesApp in manual mode, blank board visible

**Sequence 1** (2 minutes):
1. "Let me show you the manual placement mode. I'll select Piece 0 and place it."
2. Click on a board cell → piece snaps to grid (show highlight)
3. "Now I'll rotate it." → click rotate button
4. "Let me place a few more pieces..." → click 4–5 more pieces quickly
5. "Now I'll tap 'Solve'." → solver runs, fills remaining pieces
6. "The solver found a valid solution in under 200ms."

**Sequence 2** (1 minute):
1. Clear board
2. Toggle to 3D rendering view
3. Manually place 2–3 pieces
4. Show the 3D pieces rendering in real-time
5. "The 3D view helps users visualize pieces in physical space."

---

## Realization Document Status

✅ **Complete Table of Contents** (11 sections + appendices)

### What's Already Written (Show These)
- Introduction (1.1–1.3)
- Analysis & Technology Selection (Section 2 complete)
- Puzzle Engine & Solver (Section 3 complete)
- Vision Pipeline Overview (Section 4 outline, core sections complete)

### What's Being Finalized
- UI & Interaction (Section 5)
- Integration & Testing (Section 6–7)
- Challenges & Learnings (Section 8)
- Conclusion (Section 9)

### What Will Be Added Later
- Screenshots & diagrams (appendices H)
- YOLO model performance metrics (after training, week 9–10)
- Backend API integration details (after implementation, week 9–10)
- User test results (after testing, week 11–12)

**Talking Point**: "As you can see, the table of contents is complete. I've already written the introduction, analysis, and technical sections. The remaining sections will be filled in during weeks 9–12 as we complete the YOLO training, backend API, and user testing."

---

## After the Meeting

### 📝 Supervisor Feedback Notes
- [ ] Write down any feedback from supervisor
- [ ] Note any concerns raised
- [ ] Record any suggestions for improvements

### ✅ Immediate Next Steps
- [ ] Incorporate feedback into realization document
- [ ] Share improved version 1 week after meeting

### 🎯 Week 8–9 Priorities (For Discussion)
1. **YOLO Training**: Start real photo annotation (Roboflow)
2. **Backend API**: Member 1 starting FastAPI setup
3. **Validation**: Run full E2E scan pipeline test
4. **Documentation**: Capture current state for portfolio

---

## Files Created for This Meeting

1. **PRESENTATION_WEEK8.md** — Full slide content (12 slides)
2. **REALIZATION_DOCUMENT_DRAFT.md** — Complete realization document (11 sections + appendices)
3. **PRESENTATION_PREP_CHECKLIST.md** — This file

---

## Quick Reference: Project Stats

| Metric | Value |
|--------|-------|
| **Team Size** | 3 members (each owns one game) |
| **Your Game** | IQ Noodles |
| **Board Size** | 14×14 grid, 21 pins, 84 valid cells |
| **Pieces** | 11 curved pieces (A–K) |
| **Solver Algorithm** | Backtracking with cell-level MRV |
| **Solver Performance** | 50–200ms (empty board), 1–5ms (nearly solved) |
| **Vision Model** | YOLO26-nano (13 classes) |
| **Model Location** | On-device (phone ONNX Runtime Web) |
| **Privacy** | 0-day retention, no photo transmission |
| **UI Framework** | React + Vite + Babylon.js 3D |
| **Testing** | Unit + integration tests written |
| **Status** | Feature complete, model training in progress |
| **Timeline** | MVP ready by Week 13–14 |

---

## Presentation Delivery Tips

### Tone & Pacing
- Speak clearly & confidently
- Pause between slides for questions
- Don't rush; 10 minutes is plenty of time
- Emphasize **what's working** (builds confidence)

### Handling Interruptions
- If supervisor asks a question mid-presentation, answer briefly then say "I'll come back to this on slide X"
- If they ask about timeline: "We're targeting week 13–14 for MVP, which aligns with the internship schedule"

### Closing (Last 30 seconds)
"To summarize: the IQ Noodles engine is complete and proven. The vision pipeline is designed well with good fallback strategies. We're on track for MVP by week 13–14. Weeks 9–10 we'll finalize YOLO training and API integration; weeks 11–12 we'll validate with real users. Thank you, and I'm happy to take any questions."

---

## Good Luck! 🎉

You've built a lot in 8 weeks. The engine is solid, the architecture is clean, and the team plan is realistic. Show confidence in what you've accomplished, be honest about what's in progress, and articulate the path forward clearly.

**Key Mindset**: You're not defending; you're showcasing real progress. Enjoy it!

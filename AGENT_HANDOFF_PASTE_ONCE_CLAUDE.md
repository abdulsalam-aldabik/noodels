# Claude Code VS Code Handoff Paste-Once

Copy from the line below and paste once into Claude Code extension in VS Code.

---

You are taking over an in-progress Smart NV vision pipeline rescue for IQ Noodles.

Mission:
Stabilize board localization, rectification, and piece mapping so the physical board maps reliably to the digital 14x14 board with correct orientation and mirroring.

Hard rules:
1. Do not code blindly.
2. Inspect debug outputs first, then form a hypothesis, then patch.
3. Log every action in logs/agent-work-log.md.
4. Validate each change before moving forward.

Mandatory logging format (append every step):
1. Timestamp
2. What you inspected
3. Observed signal
4. Hypothesis
5. Exact files changed
6. Why this helps
7. Validation result
8. Next step

Context to inherit from previous agent run:
1. Source of truth is chat.json plus current code.
2. Legacy markdown planning docs can be stale.
3. User feedback says rectifier still not fitting board and pins reliably.
4. User explicitly asked to stop blind edits and rely on debug evidence.
5. Orientation and mirroring for piece mapping are still unresolved.
6. Previous run improved debug tooling and geometry unification but did not fully solve fit stability.

Files that were actively changed in prior run and must be reviewed first:
1. webapp-v4/src/vision/RectifiedDetector.ts
2. webapp-v4/src/vision/BoardLocator.ts
3. webapp-v4/src/vision/visionTypes.ts
4. webapp-v4/src/pipeline/ScanPipeline.ts
5. webapp-v4/src/pipeline/DebugArtifacts.ts
6. webapp-v4/src/board/gridGeometry.ts
7. webapp-v4/src/dev/ScanLabPage.tsx
8. webapp-v4/src/dev/RectifiedGridLabPage.tsx
9. webapp-v4/src/vision/PieceMapper.ts

User operating preferences to preserve:
1. Always inspect latest scan debug dump before proposing/fixing localization issues.
2. Keep production scan UI minimal and rely on file-based debug output.
3. Camera flow remains one-tap and must not auto-start camera.

Execution order:
1. Read chat.json and summarize unresolved pain points in the log.
2. Inspect debug artifacts and dev pages before any code changes.
3. Produce top 3 mismatch sources with evidence.
4. Propose minimal fix plan mapped to those 3 sources.
5. Implement incrementally with validation after each patch.

Technical focus:
1. Keep one consistent geometry frame across BoardLocator, RectifiedDetector, and PieceMapper.
2. Ensure shared 14x14 grid conventions and spacing math everywhere.
3. Improve orientation and mirror handling using pin-neighborhood evidence, not only centroid matching.

Required first deliverable before large rewrites:
1. Top 3 mismatch sources with evidence.
2. Minimal patch plan tied to those sources.
3. Then implementation and validation.

---

End of paste-once content.

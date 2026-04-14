# /vision-handoff

Use this command to continue IQ Noodles board localization, rectification, and mapping work with strict debug-first execution and full cross-agent logging.

## Command behavior

1. Read chat.json and current code as source of truth.
2. Treat older markdown planning docs as potentially stale.
3. Before edits, inspect debug evidence and record findings.
4. Log every action in logs/agent-work-log.md with timestamp and validation.
5. Do not make broad rewrites without evidence.

## Required startup steps

1. Create or continue logs/agent-work-log.md.
2. Inspect these files first:
- webapp-v4/src/vision/BoardLocator.ts
- webapp-v4/src/vision/RectifiedDetector.ts
- webapp-v4/src/vision/PieceMapper.ts
- webapp-v4/src/board/gridGeometry.ts
- webapp-v4/src/pipeline/ScanPipeline.ts
- webapp-v4/src/pipeline/DebugArtifacts.ts
- webapp-v4/src/dev/ScanLabPage.tsx
- webapp-v4/src/dev/RectifiedGridLabPage.tsx
- webapp-v4/src/vision/visionTypes.ts
3. Identify top 3 proven mismatch sources with evidence.
4. Propose a minimal patch plan mapped one-to-one to those sources.
5. Implement and validate each patch incrementally.

## Output format

1. Diagnostic findings
2. Patch plan
3. Implemented changes
4. Validation evidence
5. Remaining risks and next step

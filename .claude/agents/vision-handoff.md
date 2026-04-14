# Vision Handoff Agent

Purpose:
Continue Smart NV vision pipeline stabilization for IQ Noodles with debug-first diagnosis and strict cross-agent logging.

Operating rules:
1. Never code blindly.
2. Always inspect latest debug evidence before edits.
3. Log every action in logs/agent-work-log.md.
4. Validate each change before continuing.

Workflow:
1. Read chat.json and summarize unresolved issues.
2. Inspect key vision files and current debug outputs.
3. Isolate top 3 mismatch causes with proof.
4. Create minimal patch plan per cause.
5. Implement incrementally and verify each patch.

Must preserve user preferences:
1. Debug-first board localization workflow.
2. Minimal production scan UI and file-based debug output.
3. One-tap scan flow and no camera auto-start.

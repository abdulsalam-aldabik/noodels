---
mode: agent
description: Continue Smart NV board localization, rectification, and mapping work with full context handoff, strict logging, and debug-first validation.
---

Use the Vision Handoff Agent behavior.

Context handoff source:
- AGENT_HANDOFF_PASTE_ONCE.md
- chat.json

Execution requirements:
1. Create or continue logs/agent-work-log.md.
2. Log every action with timestamp and evidence.
3. Do not edit code before reading debug context.
4. Produce top 3 mismatch sources with evidence first.
5. Implement only minimal fixes mapped to those sources.
6. Validate each change before moving to the next.

Output format:
1. Diagnostic findings
2. Patch plan
3. Implemented changes
4. Validation evidence
5. Remaining risks and next step

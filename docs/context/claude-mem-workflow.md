# Claude-Mem Workflow

Use this workflow when Claude starts a session and when preparing handoff.

## Session Start

1. Query claude-mem for prior project lessons and known failure patterns.
2. Write a short summary in logs/agent-work-log.md.
3. Read docs/context/vision-rebuild-context-pack.md and docs/prd/vision-rebuild-prd.md.

## During Work

1. Keep only durable, reusable insights in memory.
2. Avoid storing noisy step-by-step details that are already in logs.

## Session End

1. Save what worked, what failed, and why (short bullets).
2. Update docs/context/copilot-continuation-handoff.md if handoff is needed.
3. Run /vision-memory-sync process.

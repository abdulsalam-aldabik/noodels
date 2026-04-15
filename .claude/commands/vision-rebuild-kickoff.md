# /vision-rebuild-kickoff

Use this command when starting a full rewrite on a branch where the feature is missing or unreliable.

## Model policy

1. Use Opus for planning and architecture.
2. Use implementation models for coding tasks.
3. If per-step model switching is unavailable, state that and proceed with best available model.

## Steps

1. Read docs/context/vision-rebuild-context-pack.md.
2. Read docs/prd/vision-rebuild-prd.md.
3. Read chat.json for historical failure patterns.
4. Initialize logs/agent-work-log.md using automation/vision-rebuild/session-brief-template.md.
5. Produce:
   - failure diagnosis,
   - 2-3 architecture options,
   - recommended path,
   - phase-1 plan and acceptance checks.

Do not implement before this output is complete.

# /vision-implement-phase

Use this command for one implementation phase at a time.

## Inputs

1. Current phase from automation/vision-rebuild/state-template.json.
2. Acceptance checks from automation/vision-rebuild/phase-checklist.md.

## Required behavior

1. Implement only current phase scope.
2. Log each significant step to logs/agent-work-log.md.
3. Run validation before declaring phase complete.
4. Update automation/vision-rebuild/state-template.json.

## Output required

1. Changed files.
2. Validation evidence.
3. Remaining risks.
4. Next phase recommendation.

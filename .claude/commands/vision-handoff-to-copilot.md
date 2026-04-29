# /vision-handoff-to-copilot

Use this command when Claude finishes a phase and Copilot should continue.

## Produce these files

1. docs/context/copilot-continuation-handoff.md
2. docs/context/copilot-open-risks.md
3. docs/context/copilot-next-commands.md

## Required content

1. Current architecture and invariants.
2. What changed in this phase and why.
3. Validation evidence and unresolved failures.
4. Exact next 3 actions for Copilot.
5. Any commands Copilot should run first.

## Final step

Append handoff summary in logs/agent-work-log.md.

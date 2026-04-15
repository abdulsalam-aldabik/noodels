# /vision-token-efficiency

Use this command to reduce token usage while preserving progress quality.

## Policy (from Anthropic prompting best practices)

1. Keep instructions clear and direct.
2. Put long context in files, not repeated in chat.
3. Use structured templates (logs/state/checklists) for continuity.
4. Keep responses focused on current phase delta.
5. Avoid over-prompting and unnecessary exploration.

## Actions

1. Read only files needed for the active objective.
2. Use automation/vision-rebuild/*.md templates instead of repeating instructions.
3. Save durable state to automation/vision-rebuild/state-template.json.
4. Summarize completed work in <= 10 lines before next action.
5. Keep logs concise and factual.

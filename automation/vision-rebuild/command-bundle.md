# Command Bundle

Use these commands as reusable building blocks to avoid repeating long instructions in chat.

## Environment

```powershell
# repo root
Get-Location
```

## Webapp v4 Common Commands

```powershell
cd webapp-v4
npm install
npm run dev
npm run build
npm run lint
```

## Quick Debug Artifact Check

```powershell
# from repo root
Get-ChildItem webapp-v4/debug-output -File | Sort-Object LastWriteTime -Descending | Select-Object -First 10
```

## Git State Snapshot

```powershell
git status --short
git diff --name-only
```

## Logging Shortcut Template

Use this block in logs/agent-work-log.md:

```markdown
## YYYY-MM-DD HH:MM:SS
1. Inspected
2. Observed signal
3. Hypothesis
4. Files changed
5. Why this helps
6. Validation result
7. Next step
```

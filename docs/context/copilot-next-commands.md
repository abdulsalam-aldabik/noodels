# Copilot Next Commands

Run from repo root unless noted.

```powershell
# 1) confirm working tree and script syntax
git status --short
python -m py_compile automation/vision-rebuild/blender_solved_diagnostics.py
```

```powershell
# 2) run diagnostics on the active Blender scene
# Replace $BLEND with the actual scene path used for generation.
$BLEND = "C:\path\to\your\scene.blend"
blender "$BLEND" --background --python automation/vision-rebuild/blender_solved_diagnostics.py
```

If `blender` is not on PATH, use the full executable path, for example:

```powershell
"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe" "$BLEND" --background --python automation/vision-rebuild/blender_solved_diagnostics.py
```

```powershell
# 3) locate latest diagnostics folder
$LATEST = Get-ChildItem debug-output -Directory |
	Where-Object { $_.Name -like "solved-diagnostics-*" } |
	Sort-Object LastWriteTime -Descending |
	Select-Object -First 1

$LATEST.FullName
Get-Content (Join-Path $LATEST.FullName "summary.md")
```

Immediate continuation checklist:
- Inspect `report.json` for:
	- `objects.board_inner_exists`
	- board vs board_inner bounds
	- per-attempt `overlap_sum`, `inside_frame`, `accepted_by_current_gate`
	- per-piece `rotation_euler` and `bbox2d`
- If accepted count is zero but placements are visually close, tune solved acceptance thresholds conservatively.
- If accepted attempts still look off-grid, fix solved grid frame selection (board_inner transform/axes) before threshold tuning.

Suggested checkpoint after diagnostics interpretation:

```powershell
git add automation/vision-rebuild/blender_solved_diagnostics.py docs/context/copilot-continuation-handoff.md docs/context/copilot-open-risks.md docs/context/copilot-next-commands.md docs/context/copilot-new-session-prompt.md logs/agent-work-log.md
git commit -m "blender: add solved diagnostics and continuation handoff"
```

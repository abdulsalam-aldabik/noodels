param(
    [int]$Total = 10,
    [string]$BlenderExe = "D:\blender.exe",
    [string]$ScenePath = "scene.blend",
    [string]$SmokeRoot = "debug-output/smoke-yolo-dataset",
    [switch]$SkipOverlay
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sceneAbs = if ([System.IO.Path]::IsPathRooted($ScenePath)) { $ScenePath } else { Join-Path $repoRoot $ScenePath }
$smokeAbs = if ([System.IO.Path]::IsPathRooted($SmokeRoot)) { $SmokeRoot } else { Join-Path $repoRoot $SmokeRoot }

$runner = Join-Path $repoRoot "automation\vision-rebuild\smoke_runner_temp.py"
$validator = Join-Path $repoRoot "automation\vision-rebuild\validate_smoke_dataset.py"
$overlay = Join-Path $repoRoot "automation\vision-rebuild\overlay_smoke_labels.py"

if (-not (Test-Path $BlenderExe)) {
    throw "Blender executable not found: $BlenderExe"
}
if (-not (Test-Path $sceneAbs)) {
    throw "Scene file not found: $sceneAbs"
}

$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}

Push-Location $repoRoot
try {
    Write-Host "Running Blender smoke generation ($Total images)..."
    & $BlenderExe $sceneAbs --background --python $runner -- --total $Total --output-dir $smokeAbs
    if ($LASTEXITCODE -ne 0) {
        throw "Smoke generation failed with exit code $LASTEXITCODE"
    }

    Write-Host "Validating labels..."
    & $pythonExe $validator $smokeAbs
    if ($LASTEXITCODE -ne 0) {
        throw "Validation failed with exit code $LASTEXITCODE"
    }

    if (-not $SkipOverlay) {
        Write-Host "Rendering overlays..."
        & $pythonExe $overlay $smokeAbs --limit $Total
        if ($LASTEXITCODE -ne 0) {
            throw "Overlay rendering failed with exit code $LASTEXITCODE"
        }
    }

    Write-Host "Done. Smoke dataset: $smokeAbs"
    Write-Host "Validation reports: $(Join-Path $smokeAbs "validation-report.json") and $(Join-Path $smokeAbs "validation-report.md")"
    if (-not $SkipOverlay) {
        Write-Host "Overlay images: $(Join-Path $smokeAbs "annotated-overlays")"
    }
}
finally {
    Pop-Location
}

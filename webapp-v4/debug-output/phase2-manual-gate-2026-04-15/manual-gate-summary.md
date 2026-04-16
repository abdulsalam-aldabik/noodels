# Phase 2 Manual Fixture Gate Summary

Date: 2026-04-15
Route: /dev/scan-lab (http://localhost:5174/dev/scan-lab)

## Fixture Results

| Fixture | Status | Corner Source | Corner Score | Hinge Found | Cell Spacing | Message |
|---|---|---|---:|---|---|---|
| 20260312_131204.jpg | failed | fallback_bbox | 0.000 | false | - | no board detection |
| 20260324_142332.jpg | failed | fallback_bbox | 0.000 | false | - | no board detection |
| 20260324_150837.jpg | failed | fallback_bbox | 0.000 | false | - | no board detection |
| 20260414_144554.jpg | failed | fallback_bbox | 0.000 | false | - | no board detection |

## Observed Signal

- Console warning present during runs: model outputs 264 classes, expected 13.
- Reports contain many class_### labels and no board class localization candidates.
- All fixtures fail localization and therefore do not produce a usable rectification gate signal.

## Gate Outcome

- Phase 2 manual fixture gate was executed and evidence was saved.
- Acceptance did not pass because all four fixtures failed board localization.

## Evidence Files

- 20260312_131204-report.json
- 20260312_131204-corners.png
- 20260312_131204-rectified.png
- 20260324_142332-report.json
- 20260324_142332-corners.png
- 20260324_142332-rectified.png
- 20260324_150837-report.json
- 20260324_150837-corners.png
- 20260324_150837-rectified.png
- 20260414_144554-report.json
- 20260414_144554-corners.png
- 20260414_144554-rectified.png

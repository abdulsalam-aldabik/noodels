# Phase 2 Manual Fixture Gate Summary (After Inference Decode Fix)

Date: 2026-04-15
Route: /dev/scan-lab (http://localhost:5174/dev/scan-lab)

## Fixture Results

| Fixture | Status | Corner Source | Corner Score | Hinge Found | Cell Spacing | Message |
|---|---|---|---:|---|---:|---|
| 20260312_131204.jpg | ok | bbox_fused | 0.913 | false | 40.000 | - |
| 20260324_142332.jpg | ok | bbox_fused | 0.906 | false | 40.000 | - |
| 20260324_150837.jpg | ok | bbox_fused | 0.920 | false | 40.000 | - |
| 20260414_144554.jpg | ok | fallback_bbox | 0.921 | false | 40.000 | - |

## Observed Signal

- ONNX output format is end-to-end [1,300,38] and now decoded correctly in webapp-v4 inference.
- Class histogram now includes board detections on all 4 fixtures.
- Localization succeeds on all fixtures with status ok and expected cell spacing 40 px.

## Gate Outcome

- Phase 2 manual fixture gate: PASS after inference decode fix.
- Remaining risk: hinge is still absent in these fixtures (hingeFound=false).

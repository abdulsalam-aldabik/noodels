# Vision Rebuild Context Pack

This file is intentionally self-contained for starting on branches where the feature is absent.

## Domain

Project: Smart NV puzzle tracking for IQ Noodles.

Core requirement:
- Convert camera/photo input into accurate digital board state.

Privacy requirement:
- Do not transmit photos; process vision locally and send board-state JSON only.

## Board and Geometry Facts

1. Board model uses a 14x14 grid.
2. Historical mismatch risk: center-based vs edge-based coordinate assumptions.
3. Mapping quality depends on consistent frame definitions across:
   - board localization,
   - rectification,
   - piece mapping.

## Known Historical Failure Patterns

1. Top inset defaults over-trimmed board and shifted mapping.
2. Corner scoring favored axis-aligned bbox over true perspective candidates.
3. Ambiguity rules were too loose and marked many pieces ambiguous.
4. Feature changes landed without fresh debug scans.
5. Orientation/mirroring remained unresolved after geometry tweaks.

## Data/Training Constraints

1. Existing audit indicated class-12 hinge labels missing in main local dataset snapshot.
2. Hinge may be unreliable as sole orientation anchor.
3. Need fallback orientation logic based on board/pin evidence.

## Required Rebuild Philosophy

1. Evidence first, no blind rewrites.
2. Small phases with explicit acceptance checks.
3. Keep debug artifacts first-class.
4. Preserve uncertainty states where confidence is low.

## Initial Deliverables Required

1. Failure diagnosis.
2. 2-3 architecture options.
3. Recommended path and rationale.
4. Phase-1 implementation plan.

## Must-Preserve UX Preferences

1. Scan UX should remain simple.
2. Camera should not auto-start.
3. One-tap scan flow should remain possible.
4. Debug can be file-based for deeper analysis.

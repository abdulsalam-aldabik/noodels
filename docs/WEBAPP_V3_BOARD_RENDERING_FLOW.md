# Webapp-v3 Board Rendering Flow

This note explains how the IQ Noodles board in webapp-v3 is connected and rendered after the merged-board interaction rewrite.

## 1) Main ownership

- `IQNoodlesApp.tsx` is the orchestration layer.
- `boardCoordinator.ts` is the single source of truth for coordinate transforms.
- `BoardScene3D.tsx` renders the 3D models only (no input handling).

## 2) Layer model in the UI

The merged board (`.merged-board`) has three stacked layers:

1. `board-visual-layer` (SVG, z-index 1)
   - Draws board cells, pins, preview circles, and placed circles.
   - `pointer-events: none` so it never captures clicks.
2. `board-scene-3d` (Canvas, z-index 2)
   - Draws 3D piece meshes aligned with board coordinates.
   - `pointer-events: none` so it never blocks interaction.
3. `board-interaction-layer` (div, z-index 3)
   - Receives all pointer input (`onPointerMove`, `onPointerLeave`, `onPointerDown`).
   - Converts pointer position to board-space via `BoardCoordinator.domToBoardPoint(...)`.

This guarantees one input owner and avoids SVG/Canvas hit-testing conflicts.

## 3) Placement flow

When the user clicks the board:

1. Pointer event arrives at interaction layer.
2. DOM coordinates are mapped to board coordinates using `BoardCoordinator`.
3. Board point is converted to row/col target.
4. Candidate placements are filtered to ignore occupied cells.
5. Best candidate is chosen by center-distance scoring to target row/col.
6. If selected orientation has no candidate, orientation fallback is allowed.
7. Chosen placement is applied to React state (`placedByPiece`).

When the pointer moves:

1. Hover point updates.
2. Preview placement is recomputed from the same mapping path.
3. SVG preview circles render from that placement.

## 4) Why 2D and 3D stay aligned

Both 2D and 3D use the same coordinator math:

- 2D rendering uses board-space points (`rowColToBoardPoint`).
- 3D rendering uses world-space points (`rowColToWorldPoint`).
- Click mapping uses DOM -> board-space (`domToBoardPoint`) then board-space -> row/col.

Because all three paths share one transform authority, visual and interactive alignment stay consistent.

## 5) Files to read first

- `webapp-v3/src/iq-noodles-app/IQNoodlesApp.tsx`
- `webapp-v3/src/iq-noodles-app/boardCoordinator.ts`
- `webapp-v3/src/iq-noodles-app/BoardScene3D.tsx`
- `webapp-v3/src/iq-noodles-app/iq-noodles-app.css`

## 6) Quick debugging checklist

If click placement fails:

1. Confirm interaction layer is topmost (`z-index: 3`).
2. Confirm visual and 3D layers have `pointer-events: none`.
3. Enable debug panel and verify mapped local coordinates and candidate counts.
4. Verify selected piece still has at least one free placement.

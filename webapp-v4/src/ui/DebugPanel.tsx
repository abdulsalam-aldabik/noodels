import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import { getPieceTuning } from "../pieces/tuning";
import type { PiecePlacement } from "../engine/types";

interface OrientationMeta {
  mirrored: boolean;
  rotationSteps: 0 | 1 | 2 | 3;
}

export interface DebugPanelProps {
  selectedPieceId: number;
  selectedOrientation: number;
  orientationMetaByPiece: Record<number, Record<number, OrientationMeta>>;
  orientationIndicesByPiece: Record<number, number[]>;
  placedByPiece: Record<number, PiecePlacement>;
  placementInfo: string;
  offsetOverrides: Record<number, Record<number, { x: number; y: number; scale: number }>>;
  onNudgeOffset: (pieceId: number, orientationIndex: number, axis: "x" | "y", delta: number) => void;
  onNudgeScale: (pieceId: number, orientationIndex: number, delta: number) => void;
  onResetOffset: (pieceId: number) => void;
}

export default function DebugPanel({
  selectedPieceId,
  selectedOrientation,
  orientationMetaByPiece,
  orientationIndicesByPiece,
  placedByPiece,
  placementInfo,
  offsetOverrides,
  onNudgeOffset,
  onNudgeScale,
  onResetOffset,
}: Readonly<DebugPanelProps>) {
  const selectedMeta = orientationMetaByPiece[selectedPieceId]?.[selectedOrientation];
  const available = orientationIndicesByPiece[selectedPieceId] ?? [];

  const sameMirror = available
    .filter((i) => (orientationMetaByPiece[selectedPieceId]?.[i]?.mirrored ?? false) === (selectedMeta?.mirrored ?? false))
    .sort((a, b) => {
      const ra = orientationMetaByPiece[selectedPieceId]?.[a]?.rotationSteps ?? 0;
      const rb = orientationMetaByPiece[selectedPieceId]?.[b]?.rotationSteps ?? 0;
      return ra - rb || a - b;
    });

  const selectedKey = PIECE_ASSET_BY_ID[selectedPieceId].key;

  return (
    <>
      {/* Orientation info */}
      <pre className="debug-panel" aria-label="Orientation debug panel">
        {[
          `selectedPiece=${selectedKey}(${selectedPieceId})`,
          `selectedOrientation=${selectedOrientation}`,
          `selectedRotationSteps=${selectedMeta?.rotationSteps ?? "?"}`,
          `selectedMirrored=${selectedMeta?.mirrored ?? "?"}`,
          `rotatePool=${sameMirror.map((i) => `${i}[r${orientationMetaByPiece[selectedPieceId]?.[i]?.rotationSteps ?? "?"}]`).join(" ") || "none"}`,
        ].join("\n")}
      </pre>

      {/* Placement info (populated on board click / place first fit) */}
      {placementInfo && (
        <pre className="debug-panel" aria-label="Placement debug panel">{placementInfo}</pre>
      )}

      {/* Per-orientation offset tuning for the placed selected piece */}
      {placedByPiece[selectedPieceId] && (() => {
        const placedOi = placedByPiece[selectedPieceId]!.orientationIndex;
        const tuning = getPieceTuning(selectedPieceId);
        const base = tuning.orientationOffsets?.[placedOi] ?? { x: 0, y: 0 };
        const override = offsetOverrides[selectedPieceId]?.[placedOi]
          ?? { x: base.x, y: base.y, scale: tuning.residualScale ?? 1 };

        return (
          <div className="debug-panel" aria-label="Piece offset tuning">
            <strong>Piece {selectedKey} orientation={placedOi} — copy to tuning.ts</strong>
            <pre>{`  ${selectedPieceId}: { ..., orientationOffsets: { ${placedOi}: { x: ${override.x}, y: ${override.y} } } }`}</pre>
            <div className="controls-row">
              <button type="button" onClick={() => onNudgeScale(selectedPieceId, placedOi, -0.01)}>S−</button>
              <button type="button" onClick={() => onNudgeScale(selectedPieceId, placedOi, +0.01)}>S+</button>
              <button type="button" onClick={() => onNudgeOffset(selectedPieceId, placedOi, "x", -0.1)}>X−</button>
              <button type="button" onClick={() => onNudgeOffset(selectedPieceId, placedOi, "x", +0.1)}>X+</button>
              <button type="button" onClick={() => onNudgeOffset(selectedPieceId, placedOi, "y", -0.1)}>Y−</button>
              <button type="button" onClick={() => onNudgeOffset(selectedPieceId, placedOi, "y", +0.1)}>Y+</button>
              <button type="button" onClick={() => onResetOffset(selectedPieceId)}>Reset</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}

import type { BoardCoordinator } from "../board/BoardCoordinator";
import { BOARD_CELL_RADIUS, PIN_CORE_RADIUS, PIN_RING_RADIUS } from "../board/metrics";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import type { PlacedModel } from "../rendering/BoardScene3D";
import BoardScene3D from "../rendering/BoardScene3D";
import type { PiecePlacement } from "../engine/types";

interface BoardCell {
  position: number;
  x: number;
  y: number;
}

interface PinCenter {
  pinIndex: number;
  x: number;
  y: number;
}

interface PlacedCell {
  pieceId: number;
  position: number;
  x: number;
  y: number;
}

export interface BoardCanvasProps {
  coordinator: BoardCoordinator;
  boardCells: BoardCell[];
  pinCenters: PinCenter[];
  placedCells: PlacedCell[];
  placedModels: PlacedModel[];
  previewPlacement: PiecePlacement | null;
  selectedPieceId: number;
  showDebug: boolean;
  placedByPiece: Record<number, PiecePlacement>;
  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export default function BoardCanvas({
  coordinator,
  boardCells,
  pinCenters,
  placedCells,
  placedModels,
  previewPlacement,
  selectedPieceId,
  showDebug,
  placedByPiece,
  onPointerMove,
  onPointerLeave,
  onPointerDown,
}: Readonly<BoardCanvasProps>) {
  const { boardSize } = coordinator;

  return (
    <div className="merged-board">
      {/* Invisible interaction layer sits on top and captures pointer events */}
      <div
        className="board-interaction-layer"
        aria-label="IQ Noodles interaction layer"
        role="region"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
      />

      {/* SVG layer: board grid, pins, placed cell dots, preview */}
      <svg
        className="board-visual-layer"
        viewBox={`0 0 ${boardSize} ${boardSize}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="IQ Noodles board visuals"
      >
        <rect x={0} y={0} width={boardSize} height={boardSize} rx={18} className="board-frame" />

        {boardCells.map((cell) => (
          <circle key={cell.position} cx={cell.x} cy={cell.y} r={BOARD_CELL_RADIUS} className="board-cell" />
        ))}

        {pinCenters.map((pin) => (
          <g key={pin.pinIndex}>
            <circle cx={pin.x} cy={pin.y} r={PIN_RING_RADIUS} className="pin-ring" />
            <circle cx={pin.x} cy={pin.y} r={PIN_CORE_RADIUS} className="pin-core" />
          </g>
        ))}

        {previewPlacement?.positions.map((position) => {
          const [row, col] = coordinator.toRowCol(position);
          const point = coordinator.rowColToBoardPoint(row, col);
          return (
            <circle
              key={`preview-${position}`}
              cx={point.x}
              cy={point.y}
              r={8.5}
              className="preview-cell"
              fill={PIECE_ASSET_BY_ID[selectedPieceId].colorHex}
            />
          );
        })}

        {placedCells.map((cell) => (
          <circle
            key={`${cell.pieceId}-${cell.position}`}
            cx={cell.x}
            cy={cell.y}
            r={8.5}
            className="placed-cell"
            fill={PIECE_ASSET_BY_ID[cell.pieceId].colorHex}
          />
        ))}

        {showDebug && placedModels.map((model) => {
          const asset = PIECE_ASSET_BY_ID[model.pieceId];
          const centerPoint = coordinator.rowColToBoardPoint(model.centerRow, model.centerCol);
          return (
            <text key={`debug-${model.pieceId}`} x={centerPoint.x} y={centerPoint.y} className="debug-label">
              {`${asset.key} o${placedByPiece[model.pieceId]?.orientationIndex ?? "?"} r${model.rotationSteps}${model.mirrored ? " M" : ""}`}
            </text>
          );
        })}
      </svg>

      {/* 3D layer: OBJ models overlaid on SVG */}
      <BoardScene3D coordinator={coordinator} placedModels={placedModels} />
    </div>
  );
}

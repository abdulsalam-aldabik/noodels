import { useMemo, useState } from "react";

import { NoodlesBoard } from "../engine/board";
import { IQ_NOODLES_PIECES, POSITIONS_AROUND_PINS } from "../engine/constants";
import { findAllOrientations } from "../engine/orientation";
import { generatePlacementsForPiece } from "../engine/placements";
import type { PiecePlacement } from "../engine/types";
import { BoardCoordinator, getPinCenter } from "../board/BoardCoordinator";
import { BOARD_CELL_RADIUS, PIN_CORE_RADIUS, PIN_RING_RADIUS } from "../board/metrics";
import { getPieceTuning } from "../pieces/tuning";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import { CONNECTOR_ANCHORS } from "../pieces/connectorAnchors";
import BoardScene3D from "../rendering/BoardScene3D";
import type { PlacedModel } from "../rendering/BoardScene3D";

import "../styles/app.css";
import "./piece-calibration.css";

interface CalibrationState {
  residualScale: number;
  residualOffsetX: number;
  residualOffsetY: number;
}

const DEFAULT_CALIBRATION: CalibrationState = {
  residualScale: 1,
  residualOffsetX: 0,
  residualOffsetY: 0,
};

function getPlacementFootprint(positions: number[], boardWidth: number): { spanRows: number; spanCols: number } {
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  for (const position of positions) {
    const row = Math.floor(position / boardWidth);
    const col = position % boardWidth;
    minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
  }
  return { spanRows: maxRow - minRow, spanCols: maxCol - minCol };
}

function pickReferencePlacement(pieceId: number, board: NoodlesBoard): PiecePlacement {
  const placements = generatePlacementsForPiece(pieceId, board);
  return (
    placements.find((p) =>
      p.orientationIndex === 0 && (p.rotationSteps ?? 0) === 0 && (p.mirrored ?? false) === false,
    ) ?? placements[0]
  );
}

/**
 * Computes the distance from each connector endpoint (projected into board-space
 * using the current calibration) to the nearest pin center.
 * Returns null if connector anchor data is unavailable for the piece.
 */
function computeEndpointError(
  pieceId: number,
  centerRow: number,
  centerCol: number,
  spanRows: number,
  spanCols: number,
  rotationSteps: 0 | 1 | 2 | 3,
  mirrored: boolean,
  residualScale: number,
  coordinator: BoardCoordinator,
  pinCenters: Array<{ x: number; y: number }>,
): { errorA: number; errorB: number; avgError: number } | null {
  const anchors = CONNECTOR_ANCHORS[pieceId];
  if (!anchors) return null;

  const tuning = getPieceTuning(pieceId);
  const totalMirrored = mirrored !== tuning.baseMirrored;
  const rawSteps = (rotationSteps + tuning.baseRotationSteps + 4) % 4;
  const mirroredAdjustedSteps = (totalMirrored && tuning.invertRotationWhenMirrored)
    ? (4 - rawSteps) % 4 : rawSteps;
  const totalSteps = ((totalMirrored && tuning.swapEvenStepsWhenMirrored)
    ? (mirroredAdjustedSteps === 0 ? 2 : mirroredAdjustedSteps === 2 ? 0 : mirroredAdjustedSteps)
    : mirroredAdjustedSteps) as 0 | 1 | 2 | 3;

  const needsSwap = totalSteps % 2 === 1;
  const connectorSpanX = spanCols * coordinator.cellSize;
  const connectorSpanY = spanRows * coordinator.cellSize;
  const expectedSpanX = needsSwap ? connectorSpanY : connectorSpanX;
  const expectedSpanY = needsSwap ? connectorSpanX : connectorSpanY;

  const [[ax, ay], [bx, by]] = anchors.endpoints;
  const canonicalSpanX = Math.abs(bx - ax);
  const canonicalSpanY = Math.abs(by - ay);
  const scaleX = expectedSpanX / Math.max(canonicalSpanX, 1e-6);
  const scaleY = expectedSpanY / Math.max(canonicalSpanY, 1e-6);
  const uniformScale = Math.sqrt(scaleX * scaleY) * residualScale;

  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  const endpointsLocal = [
    [(ax - midX) * uniformScale, (ay - midY) * uniformScale],
    [(bx - midX) * uniformScale, (by - midY) * uniformScale],
  ];

  const angle = totalSteps * (Math.PI / 2);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const rotated = endpointsLocal.map(([ex, ey]) => {
    const rx = totalMirrored ? -ex : ex;
    const fx = rx * cosA - ey * sinA;
    const fy = rx * sinA + ey * cosA;
    return [fx, fy];
  });

  const centerPoint = coordinator.rowColToBoardPoint(centerRow, centerCol);
  const boardEndpoints = rotated.map(([rx, ry]) => ({
    x: centerPoint.x + rx,
    y: centerPoint.y - ry, // SVG Y is top-down; world Y is bottom-up
  }));

  const findMinDist = (pt: { x: number; y: number }): number => {
    let minDist = Infinity;
    for (const pin of pinCenters) {
      const d = Math.sqrt((pt.x - pin.x) ** 2 + (pt.y - pin.y) ** 2);
      if (d < minDist) minDist = d;
    }
    return minDist;
  };

  const errorA = findMinDist(boardEndpoints[0]);
  const errorB = findMinDist(boardEndpoints[1]);
  return { errorA, errorB, avgError: (errorA + errorB) / 2 };
}

function getErrorColor(error: number): string {
  if (error < 5) return "#22c55e";
  if (error < 12) return "#eab308";
  return "#ef4444";
}

export default function PieceCalibrationPage() {
  const board = useMemo(() => new NoodlesBoard(), []);
  const coordinator = useMemo(
    () => new BoardCoordinator(board.width, board.height),
    [board.width, board.height],
  );

  const [selectedPieceId, setSelectedPieceId] = useState(0);
  const [calibrationByPiece, setCalibrationByPiece] = useState<Record<number, CalibrationState>>({});

  const { boardSize } = coordinator;

  const boardCells = useMemo(() => {
    const cells: Array<{ position: number; x: number; y: number }> = [];
    for (let position = 0; position < board.width * board.height; position++) {
      if (!board.isFree(position)) continue;
      const [row, col] = coordinator.toRowCol(position);
      const point = coordinator.rowColToBoardPoint(row, col);
      cells.push({ position, x: point.x, y: point.y });
    }
    return cells;
  }, [board, coordinator]);

  const pinCenters = useMemo(() => {
    return POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
      const [row, col] = getPinCenter(positions, coordinator);
      const point = coordinator.rowColToBoardPoint(row, col);
      return { pinIndex, x: point.x, y: point.y };
    });
  }, [coordinator]);

  const orientationCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      counts[piece.id] = findAllOrientations(piece).length;
    });
    return counts;
  }, []);

  const placedModels = useMemo<(PlacedModel & { spanRows: number; spanCols: number })[]>(() => {
    return IQ_NOODLES_PIECES.map((piece) => {
      const placement = pickReferencePlacement(piece.id, board);
      const footprint = getPlacementFootprint(placement.positions, board.width);
      const asset = PIECE_ASSET_BY_ID[piece.id];

      let sumRow = 0, sumCol = 0;
      for (const pos of placement.positions) {
        sumRow += Math.floor(pos / board.width);
        sumCol += pos % board.width;
      }
      const count = placement.positions.length || 1;

      return {
        pieceId: piece.id,
        colorHex: asset.colorHex,
        modelUrl: asset.objUrl,
        centerRow: sumRow / count,
        centerCol: sumCol / count,
        orientationIndex: placement.orientationIndex,
        rotationSteps: placement.rotationSteps ?? 0,
        mirrored: placement.mirrored ?? false,
        spanRows: footprint.spanRows,
        spanCols: footprint.spanCols,
      };
    });
  }, [board]);

  const selectedCalibration = calibrationByPiece[selectedPieceId] ?? DEFAULT_CALIBRATION;

  const calibratedModels = useMemo<PlacedModel[]>(() => {
    return placedModels
      .filter((m) => m.pieceId === selectedPieceId)
      .map((model) => {
        const cal = calibrationByPiece[model.pieceId];
        if (!cal) return model;
        return {
          ...model,
          residualScale: cal.residualScale,
          residualOffsetX: cal.residualOffsetX,
          residualOffsetY: cal.residualOffsetY,
        };
      });
  }, [placedModels, selectedPieceId, calibrationByPiece]);

  const errorMetrics = useMemo(() => {
    const metrics: Record<number, { errorA: number; errorB: number; avgError: number } | null> = {};
    for (const model of placedModels) {
      const cal = calibrationByPiece[model.pieceId] ?? DEFAULT_CALIBRATION;
      metrics[model.pieceId] = computeEndpointError(
        model.pieceId,
        model.centerRow,
        model.centerCol,
        model.spanRows,
        model.spanCols,
        model.rotationSteps,
        model.mirrored,
        cal.residualScale,
        coordinator,
        pinCenters,
      );
    }
    return metrics;
  }, [placedModels, calibrationByPiece, coordinator, pinCenters]);

  const exportJson = useMemo(() => {
    const compact = Object.entries(calibrationByPiece)
      .filter(([, s]) =>
        Math.abs(s.residualScale - 1) > 0.0001
        || Math.abs(s.residualOffsetX) > 0.0001
        || Math.abs(s.residualOffsetY) > 0.0001,
      )
      .sort(([a], [b]) => Number(a) - Number(b))
      .reduce<Record<string, CalibrationState>>((acc, [id, state]) => {
        acc[id] = {
          residualScale: Number(state.residualScale.toFixed(4)),
          residualOffsetX: Number(state.residualOffsetX.toFixed(4)),
          residualOffsetY: Number(state.residualOffsetY.toFixed(4)),
        };
        return acc;
      }, {});
    return JSON.stringify(compact, null, 2);
  }, [calibrationByPiece]);

  function setSelectedCalibration(patch: Partial<CalibrationState>): void {
    setCalibrationByPiece((prev) => ({
      ...prev,
      [selectedPieceId]: { ...(prev[selectedPieceId] ?? DEFAULT_CALIBRATION), ...patch },
    }));
  }

  function resetSelected(): void {
    setCalibrationByPiece((prev) => { const n = { ...prev }; delete n[selectedPieceId]; return n; });
  }

  function resetAll(): void {
    setCalibrationByPiece({});
  }

  async function copyExport(): Promise<void> {
    await navigator.clipboard.writeText(exportJson);
  }

  const selectedError = errorMetrics[selectedPieceId];

  return (
    <div className="noodles-shell calibration-shell">
      <header className="noodles-header calibration-header">
        <h1>Piece Calibration (Dev Only)</h1>
        <p>
          Tune one piece at a time. Error metrics show connector endpoint-to-pin distance.
          Green &lt;5px · Yellow &lt;12px · Red ≥12px.
        </p>
        <p className="calibration-path">Open at /dev/piece-calibration while running npm run dev.</p>
      </header>

      <section className="board-panel">
        <div className="merged-board">
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

            {calibratedModels.map((model) => {
              const point = coordinator.rowColToBoardPoint(model.centerRow, model.centerCol);
              const isSelected = model.pieceId === selectedPieceId;
              return (
                <g key={`anchor-${model.pieceId}`}>
                  <circle
                    cx={point.x} cy={point.y}
                    r={isSelected ? 6.5 : 4.5}
                    className={isSelected ? "cal-anchor selected" : "cal-anchor"}
                    onClick={() => setSelectedPieceId(model.pieceId)}
                  />
                  <text className="debug-label" x={point.x} y={point.y - 11}>
                    {PIECE_ASSET_BY_ID[model.pieceId].key}
                  </text>
                </g>
              );
            })}
          </svg>

          <BoardScene3D coordinator={coordinator} placedModels={calibratedModels} />
        </div>
      </section>

      <section className="inventory-panel calibration-panel">
        <div className="calibration-grid">
          {/* Piece picker */}
          <div className="piece-picker">
            {placedModels.map((model) => {
              const asset = PIECE_ASSET_BY_ID[model.pieceId];
              const isSelected = selectedPieceId === model.pieceId;
              const err = errorMetrics[model.pieceId];
              const errColor = err ? getErrorColor(err.avgError) : "#888";
              return (
                <button
                  key={model.pieceId}
                  type="button"
                  className={isSelected ? "piece-select selected" : "piece-select"}
                  onClick={() => setSelectedPieceId(model.pieceId)}
                >
                  <span style={{ color: asset.colorHex }}>{asset.key}</span>
                  <small>o{orientationCounts[model.pieceId]}</small>
                  <span
                    className="error-dot"
                    style={{ backgroundColor: errColor }}
                    title={err ? `${err.avgError.toFixed(1)}px` : "?"}
                  />
                </button>
              );
            })}
          </div>

          {/* Calibration controls */}
          <div className="controls-stack">
            <h2>
              Piece {PIECE_ASSET_BY_ID[selectedPieceId].key}
              {selectedError && (
                <span style={{ color: getErrorColor(selectedError.avgError), marginLeft: 12, fontSize: "0.8em" }}>
                  Err: {selectedError.avgError.toFixed(1)}px (A:{selectedError.errorA.toFixed(1)} B:{selectedError.errorB.toFixed(1)})
                </span>
              )}
            </h2>

            <label>
              Residual Scale: {selectedCalibration.residualScale.toFixed(3)}
              <input
                type="range" min={0.7} max={1.3} step={0.001}
                value={selectedCalibration.residualScale}
                onChange={(e) => setSelectedCalibration({ residualScale: Number(e.target.value) })}
              />
            </label>

            <label>
              Offset X (cells): {selectedCalibration.residualOffsetX.toFixed(3)}
              <input
                type="range" min={-0.5} max={0.5} step={0.001}
                value={selectedCalibration.residualOffsetX}
                onChange={(e) => setSelectedCalibration({ residualOffsetX: Number(e.target.value) })}
              />
            </label>

            <label>
              Offset Y (cells): {selectedCalibration.residualOffsetY.toFixed(3)}
              <input
                type="range" min={-0.5} max={0.5} step={0.001}
                value={selectedCalibration.residualOffsetY}
                onChange={(e) => setSelectedCalibration({ residualOffsetY: Number(e.target.value) })}
              />
            </label>

            <div className="controls-row">
              <button type="button" onClick={resetSelected}>Reset Selected</button>
              <button type="button" onClick={resetAll}>Reset All</button>
              <button type="button" onClick={() => void copyExport()}>Copy JSON</button>
            </div>
          </div>

          {/* Export block */}
          <div className="export-block">
            <h2>Calibration JSON</h2>
            <pre>{exportJson}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}

import { useMemo, useState } from "react";

import {
  IQ_NOODLES_PIECES,
  NoodlesBoard,
  POSITIONS_AROUND_PINS,
  findAllOrientations,
  generatePlacementsForPiece,
} from "../iq-noodles-engine";
import type { PiecePlacement } from "../iq-noodles-engine";
import BoardScene3D from "./BoardScene3D";
import type { PlacedModel } from "./BoardScene3D";
import { BoardCoordinator, getPinCenter } from "./boardCoordinator";
import { BOARD_CELL_RADIUS, PIN_CORE_RADIUS, PIN_RING_RADIUS } from "./boardVisualMetrics";
import { getBoardPieceTuning, BOARD_PIECE_TUNING_BY_ID } from "./boardPieceTuning";
import { PIECE_ASSET_BY_ID } from "./pieceAssets";
import { CONNECTOR_ANCHORS } from "./connectorAnchors";

import "./iq-noodles-app.css";
import "./piece-calibration-dev.css";

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
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;

  positions.forEach((position) => {
    const row = Math.floor(position / boardWidth);
    const col = position % boardWidth;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  });

  return {
    spanRows: maxRow - minRow,
    spanCols: maxCol - minCol,
  };
}

function pickReferencePlacement(pieceId: number, board: NoodlesBoard): PiecePlacement {
  const placements = generatePlacementsForPiece(pieceId, board);
  const preferred = placements.find((placement) =>
    placement.orientationIndex === 0
    && (placement.rotationSteps ?? 0) === 0
    && (placement.mirrored ?? false) === false,
  );
  return preferred ?? placements[0];
}

/**
 * Compute the error metric: distance from where the connector endpoints
 * would land (in board-space) to the nearest pin center.
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

  const tuning = getBoardPieceTuning(pieceId);
  const totalMirrored = mirrored !== tuning.baseMirrored;
  const rawSteps = (rotationSteps + tuning.baseRotationSteps + 4) % 4;
  const mirroredAdjustedSteps = ((totalMirrored && tuning.invertRotationWhenMirrored)
    ? (4 - rawSteps) % 4 : rawSteps);
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
  const safeCanonicalSpanX = Math.max(canonicalSpanX, 1e-6);
  const safeCanonicalSpanY = Math.max(canonicalSpanY, 1e-6);
  const scaleX = expectedSpanX / safeCanonicalSpanX;
  const scaleY = expectedSpanY / safeCanonicalSpanY;
  const uniformScale = Math.sqrt(scaleX * scaleY) * residualScale;

  // Endpoint positions relative to piece center (after scale, before rotation/mirror)
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  const endpointsLocal = [
    [(ax - midX) * uniformScale, (ay - midY) * uniformScale],
    [(bx - midX) * uniformScale, (by - midY) * uniformScale],
  ];

  // Apply rotation
  const angle = totalSteps * (Math.PI / 2);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const rotated = endpointsLocal.map(([ex, ey]) => {
    let rx = ex, ry = ey;
    // Mirror
    if (totalMirrored) rx = -rx;
    // Rotate
    const fx = rx * cosA - ry * sinA;
    const fy = rx * sinA + ry * cosA;
    return [fx, fy];
  });

  // Convert to board-space (SVG coordinates)
  const centerPoint = coordinator.rowColToBoardPoint(centerRow, centerCol);
  const boardEndpoints = rotated.map(([rx, ry]) => ({
    x: centerPoint.x + rx,
    y: centerPoint.y - ry, // Y is flipped in board-space vs world
  }));

  // Find nearest pin for each endpoint
  const findMinDist = (pt: { x: number; y: number }): number => {
    let minDist = Infinity;
    for (const pin of pinCenters) {
      const dx = pt.x - pin.x;
      const dy = pt.y - pin.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) minDist = d;
    }
    return minDist;
  };

  const errorA = findMinDist(boardEndpoints[0]);
  const errorB = findMinDist(boardEndpoints[1]);
  return { errorA, errorB, avgError: (errorA + errorB) / 2 };
}

function getErrorColor(error: number): string {
  if (error < 5) return "#22c55e"; // green
  if (error < 12) return "#eab308"; // yellow
  return "#ef4444"; // red
}

export default function PieceCalibrationDevPage() {
  const board = useMemo(() => new NoodlesBoard(), []);
  const coordinator = useMemo(() => new BoardCoordinator(board.width, board.height), [board.height, board.width]);
  const [selectedPieceId, setSelectedPieceId] = useState(0);
  const [calibrationByPiece, setCalibrationByPiece] = useState<Record<number, CalibrationState>>({});

  const boardSize = coordinator.boardSize;

  const boardCells = useMemo(() => {
    const cells: Array<{ position: number; x: number; y: number }> = [];
    for (let position = 0; position < board.width * board.height; position += 1) {
      if (!board.isFree(position)) continue;
      const [row, col] = coordinator.toRowCol(position);
      const point = coordinator.rowColToBoardPoint(row, col);
      cells.push({ position, x: point.x, y: point.y });
    }
    return cells;
  }, [board, coordinator]);

  const pinCenters = useMemo(() => {
    return POSITIONS_AROUND_PINS.map((around, pinIndex) => {
      const [row, col] = getPinCenter(around, coordinator);
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

  const placedModels = useMemo<PlacedModel[]>(() => {
    return IQ_NOODLES_PIECES.map((piece) => {
      const placement = pickReferencePlacement(piece.id, board);
      const footprint = getPlacementFootprint(placement.positions, board.width);
      const asset = PIECE_ASSET_BY_ID[piece.id];

      // Compute center row/col from placement positions
      const center = placement.positions.reduce(
        (acc, position) => {
          const row = Math.floor(position / board.width);
          const col = position % board.width;
          acc.row += row;
          acc.col += col;
          return acc;
        },
        { row: 0, col: 0 },
      );
      const count = placement.positions.length || 1;

      return {
        pieceId: piece.id,
        colorHex: asset.colorHex,
        modelUrl: asset.objUrl,
        centerRow: center.row / count,
        centerCol: center.col / count,
        orientationIndex: placement.orientationIndex,
        rotationSteps: placement.rotationSteps ?? 0,
        mirrored: placement.mirrored ?? false,
        spanRows: footprint.spanRows,
        spanCols: footprint.spanCols,
      };
    });
  }, [board]);

  const selectedCalibration = calibrationByPiece[selectedPieceId] ?? DEFAULT_CALIBRATION;

  const visibleModels = useMemo(() => {
    return placedModels.filter((model) => model.pieceId === selectedPieceId);
  }, [placedModels, selectedPieceId]);

  // Apply calibration overrides to the tuning for the visible model
  const calibratedModels = useMemo<PlacedModel[]>(() => {
    return visibleModels;
  }, [visibleModels]);

  // Compute error metrics for each piece
  const errorMetrics = useMemo(() => {
    const metrics: Record<number, { errorA: number; errorB: number; avgError: number } | null> = {};
    for (const model of placedModels) {
      const cal = calibrationByPiece[model.pieceId] ?? DEFAULT_CALIBRATION;
      metrics[model.pieceId] = computeEndpointError(
        model.pieceId,
        model.centerRow,
        model.centerCol,
        model.spanRows ?? 0,
        model.spanCols ?? 0,
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
      .filter(([, state]) => {
        return (
          Math.abs(state.residualScale - 1) > 0.0001
          || Math.abs(state.residualOffsetX) > 0.0001
          || Math.abs(state.residualOffsetY) > 0.0001
        );
      })
      .sort(([a], [b]) => Number(a) - Number(b))
      .reduce<Record<string, CalibrationState>>((acc, [pieceId, state]) => {
        acc[pieceId] = {
          residualScale: Number(state.residualScale.toFixed(4)),
          residualOffsetX: Number(state.residualOffsetX.toFixed(4)),
          residualOffsetY: Number(state.residualOffsetY.toFixed(4)),
        };
        return acc;
      }, {});
    return JSON.stringify(compact, null, 2);
  }, [calibrationByPiece]);

  const setSelectedCalibration = (patch: Partial<CalibrationState>) => {
    setCalibrationByPiece((previous) => {
      const next = {
        ...(previous[selectedPieceId] ?? DEFAULT_CALIBRATION),
        ...patch,
      };
      return { ...previous, [selectedPieceId]: next };
    });
  };

  const resetSelected = () => {
    setCalibrationByPiece((previous) => {
      const next = { ...previous };
      delete next[selectedPieceId];
      return next;
    });
  };

  const resetAll = () => setCalibrationByPiece({});

  const copyExport = async () => {
    await navigator.clipboard.writeText(exportJson);
  };

  // Apply calibration to tuning (temporarily mutate for rendering)
  // We need to pass the residual values through the tuning system.
  // The BoardScene3D reads tuning directly, so we temporarily override.
  useMemo(() => {
    for (const [pieceIdStr, cal] of Object.entries(calibrationByPiece)) {
      const pieceId = Number(pieceIdStr);
      const tuning = BOARD_PIECE_TUNING_BY_ID[pieceId];
      if (tuning) {
        tuning.residualScale = cal.residualScale;
        tuning.residualOffsetX = cal.residualOffsetX;
        tuning.residualOffsetY = cal.residualOffsetY;
      }
    }
    // Reset non-calibrated pieces
    for (const piece of IQ_NOODLES_PIECES) {
      if (!calibrationByPiece[piece.id]) {
        const tuning = BOARD_PIECE_TUNING_BY_ID[piece.id];
        if (tuning) {
          tuning.residualScale = undefined;
          tuning.residualOffsetX = undefined;
          tuning.residualOffsetY = undefined;
        }
      }
    }
  }, [calibrationByPiece]);

  const selectedError = errorMetrics[selectedPieceId];

  return (
    <div className="noodles-shell calibration-shell">
      <header className="noodles-header calibration-header">
        <h1>Piece Calibration (Dev Only)</h1>
        <p>
          Tune one piece at a time. The deterministic pipeline computes scale from connector anchors.
          Use residual controls only for small corrections. Error metrics show endpoint-to-pin distance.
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
              const selected = model.pieceId === selectedPieceId;
              return (
                <g key={`anchor-${model.pieceId}`}>
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={selected ? 6.5 : 4.5}
                    className={selected ? "cal-anchor selected" : "cal-anchor"}
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
                  <span className="error-dot" style={{ backgroundColor: errColor }} title={err ? `${err.avgError.toFixed(1)}px` : "?"}></span>
                </button>
              );
            })}
          </div>

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
                type="range"
                min={0.7}
                max={1.3}
                step={0.001}
                value={selectedCalibration.residualScale}
                onChange={(event) => setSelectedCalibration({ residualScale: Number(event.target.value) })}
              />
            </label>

            <label>
              Offset X (cells): {selectedCalibration.residualOffsetX.toFixed(3)}
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.001}
                value={selectedCalibration.residualOffsetX}
                onChange={(event) => setSelectedCalibration({ residualOffsetX: Number(event.target.value) })}
              />
            </label>

            <label>
              Offset Y (cells): {selectedCalibration.residualOffsetY.toFixed(3)}
              <input
                type="range"
                min={-0.5}
                max={0.5}
                step={0.001}
                value={selectedCalibration.residualOffsetY}
                onChange={(event) => setSelectedCalibration({ residualOffsetY: Number(event.target.value) })}
              />
            </label>

            <div className="controls-row">
              <button type="button" onClick={resetSelected}>Reset Selected</button>
              <button type="button" onClick={resetAll}>Reset All</button>
              <button type="button" onClick={() => void copyExport()}>Copy JSON</button>
            </div>
          </div>

          <div className="export-block">
            <h2>Calibration JSON</h2>
            <pre>{exportJson}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}

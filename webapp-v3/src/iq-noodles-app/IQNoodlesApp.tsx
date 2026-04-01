import { useMemo, useState } from "react";

import {
  IQ_NOODLES_PIECES,
  NoodlesBoard,
  POSITIONS_AROUND_PINS,
  findAllOrientations,
  generatePlacementsForPiece,
} from "../iq-noodles-engine";
import type { PiecePlacement } from "../iq-noodles-engine";

import "./iq-noodles-app.css";

const CELL_SIZE = 28;
const BOARD_PADDING = 20;
const PIECE_COLORS = [
  "#8e1a08",
  "#1f6db7",
  "#8b4ecf",
  "#46a8e8",
  "#f2d44f",
  "#78b446",
  "#f38c2b",
  "#f071b5",
  "#1f9346",
  "#bfc9de",
  "#df4040",
];

function toRowCol(position: number, width: number): [number, number] {
  return [Math.floor(position / width), position % width];
}

function getPinCenter(pinPositions: readonly number[], width: number): [number, number] {
  const coords = pinPositions.map((position) => toRowCol(position, width));
  const avgRow = coords.reduce((sum, [row]) => sum + row, 0) / coords.length;
  const avgCol = coords.reduce((sum, [, col]) => sum + col, 0) / coords.length;
  return [avgRow, avgCol];
}

export default function IQNoodlesApp() {
  const board = useMemo(() => new NoodlesBoard(), []);
  const [selectedPieceId, setSelectedPieceId] = useState(0);
  const [placedByPiece, setPlacedByPiece] = useState<Record<number, PiecePlacement>>({});
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [feedback, setFeedback] = useState("Select a piece, rotate if needed, then click board to snap.");

  const [orientationByPiece, setOrientationByPiece] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      initial[piece.id] = 0;
    });
    return initial;
  });

  const boardCells = useMemo(() => {
    const cells: Array<{ position: number; x: number; y: number }> = [];
    for (let position = 0; position < board.width * board.height; position += 1) {
      if (!board.isFree(position)) {
        continue;
      }
      const [row, col] = toRowCol(position, board.width);
      cells.push({
        position,
        x: BOARD_PADDING + col * CELL_SIZE,
        y: BOARD_PADDING + row * CELL_SIZE,
      });
    }
    return cells;
  }, [board]);

  const pinCenters = useMemo(() => {
    return POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
      const [row, col] = getPinCenter(positions, board.width);
      return {
        pinIndex,
        x: BOARD_PADDING + col * CELL_SIZE,
        y: BOARD_PADDING + row * CELL_SIZE,
      };
    });
  }, [board]);

  const orientationCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      counts[piece.id] = findAllOrientations(piece).length;
    });
    return counts;
  }, []);

  const placementsByPiece = useMemo(() => {
    const placements: Record<number, PiecePlacement[]> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      placements[piece.id] = generatePlacementsForPiece(piece.id, board);
    });
    return placements;
  }, [board]);

  const pieceStats = useMemo(() => {
    return IQ_NOODLES_PIECES.map((piece) => ({
      id: piece.id,
      segments: piece.bigGridPositions.length,
      orientations: orientationCounts[piece.id],
      placements: placementsByPiece[piece.id].length,
      isPlaced: Boolean(placedByPiece[piece.id]),
      selectedOrientation: orientationByPiece[piece.id],
    }));
  }, [orientationByPiece, orientationCounts, placedByPiece, placementsByPiece]);

  const boardSize = BOARD_PADDING * 2 + (board.width - 1) * CELL_SIZE;

  const occupiedByOthers = useMemo(() => {
    const occupied = new Set<number>();
    Object.entries(placedByPiece).forEach(([key, placement]) => {
      const pieceId = Number(key);
      if (pieceId === selectedPieceId) {
        return;
      }
      placement.positions.forEach((position) => occupied.add(position));
    });
    return occupied;
  }, [placedByPiece, selectedPieceId]);

  const findBestPlacement = (
    pieceId: number,
    orientationIndex: number,
    targetX: number,
    targetY: number,
  ): PiecePlacement | null => {
    const candidates = placementsByPiece[pieceId].filter((placement) => {
      if (placement.orientationIndex !== orientationIndex) {
        return false;
      }
      return placement.positions.every((position) => !occupiedByOthers.has(position));
    });

    if (candidates.length === 0) {
      return null;
    }

    let bestPlacement: PiecePlacement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    candidates.forEach((placement) => {
      const center = placement.positions.reduce(
        (acc, position) => {
          const [row, col] = toRowCol(position, board.width);
          acc.x += BOARD_PADDING + col * CELL_SIZE;
          acc.y += BOARD_PADDING + row * CELL_SIZE;
          return acc;
        },
        { x: 0, y: 0 },
      );

      center.x /= placement.positions.length;
      center.y /= placement.positions.length;
      const score = (center.x - targetX) ** 2 + (center.y - targetY) ** 2;

      if (score < bestScore) {
        bestScore = score;
        bestPlacement = placement;
      }
    });

    return bestPlacement;
  };

  const previewPlacement = useMemo(() => {
    if (!hoverPoint) {
      return null;
    }
    return findBestPlacement(selectedPieceId, orientationByPiece[selectedPieceId], hoverPoint.x, hoverPoint.y);
  }, [hoverPoint, orientationByPiece, selectedPieceId, placementsByPiece, occupiedByOthers]);

  const getLocalPoint = (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * boardSize,
      y: ((event.clientY - rect.top) / rect.height) * boardSize,
    };
  };

  const rotateSelectedPiece = (): void => {
    const count = orientationCounts[selectedPieceId] ?? 1;
    setOrientationByPiece((previous) => ({
      ...previous,
      [selectedPieceId]: (previous[selectedPieceId] + 1) % count,
    }));
  };

  const clearBoard = (): void => {
    setPlacedByPiece({});
    setFeedback("Board cleared.");
  };

  const onBoardPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    setHoverPoint(getLocalPoint(event));
  };

  const onBoardClick = (event: React.PointerEvent<SVGSVGElement>): void => {
    const point = getLocalPoint(event);
    const candidate = findBestPlacement(selectedPieceId, orientationByPiece[selectedPieceId], point.x, point.y);
    if (!candidate) {
      setFeedback(`Piece ${selectedPieceId} has no legal snap at this orientation.`);
      return;
    }

    setPlacedByPiece((previous) => ({
      ...previous,
      [selectedPieceId]: candidate,
    }));
    setFeedback(`Piece ${selectedPieceId} snapped at orientation ${orientationByPiece[selectedPieceId]}.`);
  };

  const removePiece = (pieceId: number): void => {
    setPlacedByPiece((previous) => {
      const next = { ...previous };
      delete next[pieceId];
      return next;
    });
    setSelectedPieceId(pieceId);
    setFeedback(`Piece ${pieceId} returned to inventory.`);
  };

  const placedCells = useMemo(() => {
    return Object.entries(placedByPiece).flatMap(([id, placement]) => {
      const pieceId = Number(id);
      return placement.positions.map((position) => {
        const [row, col] = toRowCol(position, board.width);
        return {
          pieceId,
          position,
          x: BOARD_PADDING + col * CELL_SIZE,
          y: BOARD_PADDING + row * CELL_SIZE,
        };
      });
    });
  }, [board.width, placedByPiece]);

  return (
    <div className="noodles-shell">
      <header className="noodles-header">
        <p className="eyebrow">SMART NV / IQ NOODLES</p>
        <h1>Fresh Java-Parity Build</h1>
        <p>
          This is a new implementation baseline: board geometry, pin map, orientation logic, and legal placement
          generation are driven by the Java reference.
        </p>
      </header>

      <section className="board-panel">
        <div>
          <h2>Board + Pins + Snap</h2>
          <p>
            Valid cells: {board.getValidCellCount()} / {board.width * board.height} | Pins: {POSITIONS_AROUND_PINS.length}
          </p>
          <p className="controls-line">
            Selected piece: {selectedPieceId} | Orientation: {orientationByPiece[selectedPieceId]} / {orientationCounts[selectedPieceId] - 1}
          </p>
          <div className="controls-row">
            <button type="button" onClick={rotateSelectedPiece}>Rotate Selected</button>
            <button type="button" onClick={clearBoard}>Clear Board</button>
          </div>
          <p className="feedback-line">{feedback}</p>
        </div>

        <svg
          viewBox={`0 0 ${boardSize} ${boardSize}`}
          role="img"
          aria-label="IQ Noodles board preview"
          onPointerMove={onBoardPointerMove}
          onPointerLeave={() => setHoverPoint(null)}
          onPointerDown={onBoardClick}
        >
          <rect x={0} y={0} width={boardSize} height={boardSize} rx={18} className="board-frame" />

          {boardCells.map((cell) => (
            <circle
              key={cell.position}
              cx={cell.x}
              cy={cell.y}
              r={6}
              className="board-cell"
            />
          ))}

          {pinCenters.map((pin) => (
            <g key={pin.pinIndex}>
              <circle cx={pin.x} cy={pin.y} r={10} className="pin-ring" />
              <circle cx={pin.x} cy={pin.y} r={4} className="pin-core" />
            </g>
          ))}

          {previewPlacement?.positions.map((position) => {
            const [row, col] = toRowCol(position, board.width);
            return (
              <circle
                key={`preview-${position}`}
                cx={BOARD_PADDING + col * CELL_SIZE}
                cy={BOARD_PADDING + row * CELL_SIZE}
                r={8.5}
                className="preview-cell"
                fill={PIECE_COLORS[selectedPieceId]}
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
              fill={PIECE_COLORS[cell.pieceId]}
            />
          ))}
        </svg>
      </section>

      <section className="inventory-panel">
        <h2>Piece Inventory (Interactive)</h2>
        <div className="piece-grid">
          {pieceStats.map((piece) => (
            <article key={piece.id} className={`piece-card ${selectedPieceId === piece.id ? "selected" : ""}`}>
              <h3>Piece {piece.id}</h3>
              <p>Segments: {piece.segments}</p>
              <p>Unique orientations: {piece.orientations}</p>
              <p>Legal placements: {piece.placements}</p>
              <p>Current orientation: {piece.selectedOrientation}</p>
              <p>Status: {piece.isPlaced ? "On board" : "In inventory"}</p>
              <div className="piece-actions">
                <button type="button" onClick={() => setSelectedPieceId(piece.id)}>Select</button>
                <button
                  type="button"
                  onClick={() =>
                    setOrientationByPiece((previous) => ({
                      ...previous,
                      [piece.id]: (previous[piece.id] + 1) % piece.orientations,
                    }))
                  }
                >
                  Rotate
                </button>
                {piece.isPlaced && (
                  <button type="button" onClick={() => removePiece(piece.id)}>Pick Up</button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

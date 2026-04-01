import { useMemo } from "react";

import {
  IQ_NOODLES_PIECES,
  NoodlesBoard,
  POSITIONS_AROUND_PINS,
  findAllOrientations,
  generatePlacementsForPiece,
} from "../iq-noodles-engine";

import "./iq-noodles-app.css";

const CELL_SIZE = 28;
const BOARD_PADDING = 20;

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

  const pieceStats = useMemo(() => {
    return IQ_NOODLES_PIECES.map((piece) => {
      const orientations = findAllOrientations(piece).length;
      const placements = generatePlacementsForPiece(piece.id, board).length;
      return {
        id: piece.id,
        segments: piece.bigGridPositions.length,
        orientations,
        placements,
      };
    });
  }, [board]);

  const boardSize = BOARD_PADDING * 2 + (board.width - 1) * CELL_SIZE;

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
          <h2>Board + Pins</h2>
          <p>
            Valid cells: {board.getValidCellCount()} / {board.width * board.height} | Pins: {POSITIONS_AROUND_PINS.length}
          </p>
        </div>

        <svg viewBox={`0 0 ${boardSize} ${boardSize}`} role="img" aria-label="IQ Noodles board preview">
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
        </svg>
      </section>

      <section className="inventory-panel">
        <h2>Piece Inventory (Engine-Derived)</h2>
        <div className="piece-grid">
          {pieceStats.map((piece) => (
            <article key={piece.id} className="piece-card">
              <h3>Piece {piece.id}</h3>
              <p>Segments: {piece.segments}</p>
              <p>Unique orientations: {piece.orientations}</p>
              <p>Legal placements: {piece.placements}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

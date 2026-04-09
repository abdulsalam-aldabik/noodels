export interface BoardPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Translates between four coordinate spaces used by the app:
 *   - position index  (flat integer, engine representation)
 *   - [row, col]      (2D grid, 0-based)
 *   - BoardPoint      ({x, y} in SVG viewBox units)
 *   - WorldPoint      ({x, y, z} in Three.js world units, Y-up)
 *
 * All transforms are deterministic given boardWidth/boardHeight/cellSize/boardPadding.
 */
export class BoardCoordinator {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly cellSize: number;
  readonly boardPadding: number;
  /** Total SVG viewBox side length (square). */
  readonly boardSize: number;
  readonly halfBoard: number;

  constructor(boardWidth: number, boardHeight: number, cellSize = 28, boardPadding = 40) {
    this.boardWidth = boardWidth;
    this.boardHeight = boardHeight;
    this.cellSize = cellSize;
    this.boardPadding = boardPadding;
    this.boardSize = this.boardPadding * 2 + (this.boardWidth - 1) * this.cellSize;
    this.halfBoard = this.boardSize / 2;
  }

  toRowCol(position: number): [number, number] {
    return [Math.floor(position / this.boardWidth), position % this.boardWidth];
  }

  rowColToBoardPoint(row: number, col: number): BoardPoint {
    return {
      x: this.boardPadding + col * this.cellSize,
      y: this.boardPadding + row * this.cellSize,
    };
  }

  boardPointToRowCol(point: BoardPoint): { row: number; col: number } {
    return {
      row: (point.y - this.boardPadding) / this.cellSize,
      col: (point.x - this.boardPadding) / this.cellSize,
    };
  }

  domToBoardPoint(
    clientX: number,
    clientY: number,
    rectLeft: number,
    rectTop: number,
    rectWidth: number,
    rectHeight: number,
  ): BoardPoint {
    return {
      x: ((clientX - rectLeft) / rectWidth) * this.boardSize,
      y: ((clientY - rectTop) / rectHeight) * this.boardSize,
    };
  }

  rowColToWorldPoint(row: number, col: number, z = 0.02): WorldPoint {
    const board = this.rowColToBoardPoint(row, col);
    return {
      x: board.x - this.halfBoard,
      y: this.halfBoard - board.y, // SVG Y is top-down; Three.js Y is bottom-up
      z,
    };
  }
}

/** Returns the average [row, col] of the four cells surrounding a pin. */
export function getPinCenter(pinPositions: readonly number[], coordinator: BoardCoordinator): [number, number] {
  const coords = pinPositions.map((position) => coordinator.toRowCol(position));
  const avgRow = coords.reduce((sum, [row]) => sum + row, 0) / coords.length;
  const avgCol = coords.reduce((sum, [, col]) => sum + col, 0) / coords.length;
  return [avgRow, avgCol];
}

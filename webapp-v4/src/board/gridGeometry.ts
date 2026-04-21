import { POSITIONS_AROUND_PINS } from "../engine/constants";

export const GRID = 14;

/**
 * Edge-based destination corners for the rectification homography.
 * Cells occupy [col, col+1) × [row, row+1). The outer edge of cell (0,0) is
 * at (-0.5, -0.5); the outer edge of cell (13,13) is at (13.5, 13.5).
 * We add 1 cell of margin on each side to include the board's physical frame.
 * This is the SINGLE source of truth — every homography, warp, and overlay
 * must reference these values. No inline math elsewhere.
 */
export const BOARD_EDGE_MIN = -1.5;
export const BOARD_EDGE_MAX = GRID - 0.5 + 1; // 14.5
export const BOARD_EDGE_SPAN = BOARD_EDGE_MAX - BOARD_EDGE_MIN; // 16

export const BOARD_EDGE_CORNERS = {
  topLeft: { x: BOARD_EDGE_MIN, y: BOARD_EDGE_MIN },
  topRight: { x: BOARD_EDGE_MAX, y: BOARD_EDGE_MIN },
  bottomRight: { x: BOARD_EDGE_MAX, y: BOARD_EDGE_MAX },
  bottomLeft: { x: BOARD_EDGE_MIN, y: BOARD_EDGE_MAX },
} as const;

/** Expected pixel spacing between adjacent cell centers in a rectified canvas. */
export function expectedCellSpacingPx(canvasSizePx: number): number {
  return canvasSizePx / BOARD_EDGE_SPAN;
}

/**
 * Map board-space (cell column, cell row) to rectified canvas pixel coordinates.
 * board (0,0) is the center of the top-left cell.
 * Canvas (0,0) is the top-left pixel.
 */
export function boardToCanvas(
  boardX: number,
  boardY: number,
  canvasSizePx: number,
): { x: number; y: number } {
  const s = canvasSizePx / BOARD_EDGE_SPAN;
  return {
    x: (boardX - BOARD_EDGE_MIN) * s,
    y: (boardY - BOARD_EDGE_MIN) * s,
  };
}

export function canvasToBoard(
  canvasX: number,
  canvasY: number,
  canvasSizePx: number,
): { x: number; y: number } {
  const s = canvasSizePx / BOARD_EDGE_SPAN;
  return {
    x: canvasX / s + BOARD_EDGE_MIN,
    y: canvasY / s + BOARD_EDGE_MIN,
  };
}

export interface PinBoardPoint {
  /** Cell column of the pin center in board-space. */
  x: number;
  /** Cell row of the pin center in board-space. */
  y: number;
  /** Index into POSITIONS_AROUND_PINS (0..20). */
  pinIndex: number;
}

/**
 * The 21 pins sit at the shared corner of their four surrounding cells.
 * We derive pin centers from engine/constants POSITIONS_AROUND_PINS so the
 * geometry stays in lock-step with the engine. A pin's board-space location
 * is the average of its four surrounding cell centers, which is the cell
 * corner between them.
 */
export function computePinBoardPoints(): PinBoardPoint[] {
  const result: PinBoardPoint[] = [];
  for (let pinIndex = 0; pinIndex < POSITIONS_AROUND_PINS.length; pinIndex++) {
    const quad = POSITIONS_AROUND_PINS[pinIndex];
    let sumCol = 0;
    let sumRow = 0;
    for (const pos of quad) {
      const row = Math.floor(pos / GRID);
      const col = pos % GRID;
      sumCol += col;
      sumRow += row;
    }
    result.push({
      x: sumCol / quad.length,
      y: sumRow / quad.length,
      pinIndex,
    });
  }
  return result;
}

export function cellCenterOf(row: number, col: number): { x: number; y: number } {
  return { x: col, y: row };
}

export function snapToCell(
  boardX: number,
  boardY: number,
): { row: number; col: number } {
  return {
    col: Math.max(0, Math.min(GRID - 1, Math.round(boardX))),
    row: Math.max(0, Math.min(GRID - 1, Math.round(boardY))),
  };
}

import { BOARD_WIDTH, BOARD_HEIGHT, MISSING_POSITIONS } from "../engine/constants";

/**
 * Shared set of valid board cells — every (row, col) pair on the 14×14 grid
 * that is NOT in MISSING_POSITIONS.  Extracted here so PieceMapper,
 * BoardLocator, and CellCoverage all reference the same constant.
 */

const MISSING_SET = new Set<number>(MISSING_POSITIONS);

export const VALID_CELLS: [number, number][] = (() => {
  const cells: [number, number][] = [];
  for (let pos = 0; pos < BOARD_WIDTH * BOARD_HEIGHT; pos++) {
    if (!MISSING_SET.has(pos)) {
      cells.push([Math.floor(pos / BOARD_WIDTH), pos % BOARD_WIDTH]);
    }
  }
  return cells;
})();

/** Quick lookup: is a given linear position valid? */
export const VALID_POSITION_SET = new Set<number>(
  VALID_CELLS.map(([r, c]) => r * BOARD_WIDTH + c),
);

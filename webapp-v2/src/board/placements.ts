/**
 * Valid Placement Generator
 *
 * Ported from PlacingsOnNoodlesGrid.java
 *
 * For each piece × orientation, find all valid grid positions
 * (sliding the shape across the 14×14 grid and checking if
 * all cells are valid/existing).
 *
 * These are pre-computed once at startup and reused by the solver.
 */

import {
  GRID_WIDTH,
  GRID_HEIGHT,
  MISSING_POSITIONS,
  type BoardState,
} from './board';
import { NUM_PIECES, type SegmentType } from './pieces';
import { ALL_ORIENTATIONS } from './orientations';

export interface Placement {
  /** Piece index (0-10) */
  pieceIndex: number;
  /** Grid positions this placement occupies */
  positions: number[];
  /** Shape types for each position */
  shapes: SegmentType[];
}

/**
 * Pre-compute all valid placements for each piece.
 *
 * For each piece:
 *   For each orientation:
 *     Slide across the grid (all h,w offsets)
 *     Check if all resulting cells are valid (not missing, within bounds)
 *
 * Returns an array indexed by piece (0-10), each containing
 * all valid Placement objects for that piece.
 */
function computeAllPlacements(): Placement[][] {
  const allPlacements: Placement[][] = [];

  for (let piece = 0; piece < NUM_PIECES; piece++) {
    const pieceOrientations = ALL_ORIENTATIONS[piece];
    const placements: Placement[] = [];

    for (const orient of pieceOrientations) {
      // Find the bounding box of this orientation
      let maxCol = 0;
      let maxRow = 0;
      for (const pos of orient.positions) {
        const col = pos % GRID_WIDTH;
        const row = Math.floor(pos / GRID_WIDTH);
        if (col > maxCol) maxCol = col;
        if (row > maxRow) maxRow = row;
      }

      // Slide across the grid
      for (let rowOff = 0; rowOff <= GRID_HEIGHT - 1 - maxRow; rowOff++) {
        for (let colOff = 0; colOff <= GRID_WIDTH - 1 - maxCol; colOff++) {
          const offset = rowOff * GRID_WIDTH + colOff;
          const shifted = orient.positions.map(p => p + offset);

          // Check all cells are valid
          let allValid = true;
          for (const pos of shifted) {
            if (pos < 0 || pos >= GRID_WIDTH * GRID_HEIGHT || MISSING_POSITIONS.has(pos)) {
              allValid = false;
              break;
            }
          }

          if (allValid) {
            placements.push({
              pieceIndex: piece,
              positions: shifted,
              shapes: [...orient.shapes],
            });
          }
        }
      }
    }

    allPlacements.push(placements);
  }

  return allPlacements;
}

/** All valid placements, indexed by piece index. Pre-computed once. */
export const ALL_PLACEMENTS: readonly (readonly Placement[])[] = computeAllPlacements();

/**
 * Filter placements to only those that fit on the current board state.
 * (All positions must be free on the board.)
 */
export function getAvailablePlacements(
  pieceIndex: number,
  board: BoardState,
): Placement[] {
  return ALL_PLACEMENTS[pieceIndex].filter(p => board.areFree(p.positions));
}

/**
 * Get all available placements for all unplaced pieces on the current board.
 */
export function getAllAvailablePlacements(
  board: BoardState,
): Map<number, Placement[]> {
  const placed = board.getPlacedPieces();
  const available = new Map<number, Placement[]>();

  for (let piece = 0; piece < NUM_PIECES; piece++) {
    if (placed.has(piece)) continue;
    const placements = getAvailablePlacements(piece, board);
    if (placements.length > 0) {
      available.set(piece, placements);
    }
  }

  return available;
}

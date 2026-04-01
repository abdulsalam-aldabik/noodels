/**
 * Valid Placement Generator — pre-computes all valid positions for each piece.
 * Ported from PlacingsOnNoodlesGrid.java.
 */

import { GRID_WIDTH, GRID_HEIGHT, MISSING_POSITIONS, type BoardState } from './board';
import { NUM_PIECES } from './pieces';
import { ALL_ORIENTATIONS } from './orientations';
import type { Placement } from '../types';

function computeAllPlacements(): Placement[][] {
  const allPlacements: Placement[][] = [];

  for (let piece = 0; piece < NUM_PIECES; piece++) {
    const placements: Placement[] = [];
    for (const orient of ALL_ORIENTATIONS[piece]) {
      let maxCol = 0;
      let maxRow = 0;
      for (const pos of orient.positions) {
        const col = pos % GRID_WIDTH;
        const row = Math.floor(pos / GRID_WIDTH);
        if (col > maxCol) maxCol = col;
        if (row > maxRow) maxRow = row;
      }

      for (let rowOff = 0; rowOff <= GRID_HEIGHT - 1 - maxRow; rowOff++) {
        for (let colOff = 0; colOff <= GRID_WIDTH - 1 - maxCol; colOff++) {
          const offset = rowOff * GRID_WIDTH + colOff;
          const shifted = orient.positions.map(p => p + offset);

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

export const ALL_PLACEMENTS: readonly (readonly Placement[])[] = computeAllPlacements();

export function getAvailablePlacements(pieceIndex: number, board: BoardState): Placement[] {
  return ALL_PLACEMENTS[pieceIndex].filter(p => board.areFree(p.positions));
}

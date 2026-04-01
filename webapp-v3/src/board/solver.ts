/**
 * Backtracking solver with MRV heuristic.
 */

import { BoardState } from './board';
import { NUM_PIECES } from './pieces';
import { getAvailablePlacements } from './placements';
import type { Placement, SolverResult } from '../types';

const DEFAULT_TIMEOUT_MS = 5000;

export function solve(initialBoard: BoardState, timeoutMs = DEFAULT_TIMEOUT_MS): SolverResult {
  const t0 = performance.now();
  const deadline = t0 + timeoutMs;

  const placed = initialBoard.getPlacedPieces();
  const unplaced: number[] = [];
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i)) unplaced.push(i);
  }

  const solution: (Placement | null)[] = new Array(NUM_PIECES).fill(null);
  let statesExplored = 0;
  let timedOut = false;

  const board = initialBoard.clone();

  function backtrack(remaining: number[]): boolean {
    if (remaining.length === 0) return true;
    if (performance.now() > deadline) { timedOut = true; return false; }

    statesExplored++;

    // MRV: pick piece with fewest placements
    let bestPiece = -1;
    let bestPlacements: Placement[] = [];
    let bestCount = Infinity;

    for (const piece of remaining) {
      const placements = getAvailablePlacements(piece, board);
      if (placements.length === 0) return false;
      if (placements.length < bestCount) {
        bestCount = placements.length;
        bestPiece = piece;
        bestPlacements = placements;
      }
    }

    if (bestPiece === -1) return false;
    const next = remaining.filter(p => p !== bestPiece);

    for (const placement of bestPlacements) {
      board.place(placement.positions, bestPiece);
      solution[bestPiece] = placement;

      if (next.length <= 8 || board.checkOpenSpace()) {
        if (backtrack(next)) return true;
      }

      board.remove(placement.positions);
      solution[bestPiece] = null;
    }

    return false;
  }

  const solved = backtrack(unplaced);
  return { solved, solution, timeMs: performance.now() - t0, statesExplored, timedOut };
}

export function getHint(board: BoardState): { placement: Placement; fullSolution: SolverResult } | null {
  const result = solve(board, 3000);
  if (!result.solved) return null;
  const placed = board.getPlacedPieces();
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i) && result.solution[i]) {
      return { placement: result.solution[i]!, fullSolution: result };
    }
  }
  return null;
}

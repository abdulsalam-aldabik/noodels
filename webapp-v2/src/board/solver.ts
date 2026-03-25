/**
 * IQ Noodles Backtracking Solver
 *
 * Given a board state with some pieces placed, finds a valid
 * complete solution (all 11 pieces placed without overlap).
 *
 * Uses recursive backtracking with:
 * - MRV heuristic: try the piece with fewest valid placements first
 * - Open-space check: prune if empty region is disconnected
 * - Time limit: aborts after configurable timeout
 */

import { BoardState } from './board';
import { NUM_PIECES } from './pieces';
import { getAvailablePlacements, type Placement } from './placements';

export interface SolverResult {
  /** Whether a solution was found */
  solved: boolean;
  /** The solution placements (one per piece, indexed by piece index) */
  solution: (Placement | null)[];
  /** Time taken in milliseconds */
  timeMs: number;
  /** Number of states explored */
  statesExplored: number;
  /** Whether the solver timed out */
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Solve the puzzle — find a valid placement for all unplaced pieces.
 *
 * @param initialBoard The current board state with some pieces already placed
 * @param timeoutMs Maximum time to spend solving (default 5s)
 */
export function solve(
  initialBoard: BoardState,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): SolverResult {
  const t0 = performance.now();
  const deadline = t0 + timeoutMs;

  // Determine which pieces are already placed
  const placed = initialBoard.getPlacedPieces();
  const unplaced: number[] = [];
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i)) unplaced.push(i);
  }

  // Solution array: one placement per piece
  const solution: (Placement | null)[] = new Array(NUM_PIECES).fill(null);
  // Copy existing placements from initial state
  // (We don't store them as Placement objects, just mark as non-null)

  let statesExplored = 0;
  let timedOut = false;

  const board = initialBoard.clone();

  function backtrack(remainingPieces: number[]): boolean {
    if (remainingPieces.length === 0) return true; // All placed!

    // Check timeout
    if (performance.now() > deadline) {
      timedOut = true;
      return false;
    }

    statesExplored++;

    // MRV heuristic: pick the piece with fewest available placements
    let bestPiece = -1;
    let bestPlacements: Placement[] = [];
    let bestCount = Infinity;

    for (const piece of remainingPieces) {
      const placements = getAvailablePlacements(piece, board);
      if (placements.length === 0) return false; // Dead end
      if (placements.length < bestCount) {
        bestCount = placements.length;
        bestPiece = piece;
        bestPlacements = placements;
      }
    }

    if (bestPiece === -1) return false;

    const nextRemaining = remainingPieces.filter(p => p !== bestPiece);

    for (const placement of bestPlacements) {
      // Try this placement
      board.place(placement.positions, bestPiece);
      solution[bestPiece] = placement;

      // Pruning: check open space connectivity
      if (nextRemaining.length <= 8 || board.checkOpenSpace()) {
        if (backtrack(nextRemaining)) {
          return true;
        }
      }

      // Undo placement
      board.remove(placement.positions, bestPiece);
      solution[bestPiece] = null;
    }

    return false;
  }

  const solved = backtrack(unplaced);
  const timeMs = performance.now() - t0;

  return {
    solved,
    solution,
    timeMs,
    statesExplored,
    timedOut,
  };
}

/**
 * Get a hint: find one valid placement for the next unplaced piece.
 * Uses the solver to verify the placement leads to a valid solution.
 */
export function getHint(
  board: BoardState,
): { placement: Placement; fullSolution: SolverResult } | null {
  const result = solve(board, 3000);
  if (!result.solved) return null;

  // Find the first unplaced piece's placement from the solution
  const placed = board.getPlacedPieces();
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i) && result.solution[i]) {
      return {
        placement: result.solution[i]!,
        fullSolution: result,
      };
    }
  }

  return null;
}

import { BOARD_HEIGHT, BOARD_WIDTH, IQ_NOODLES_PIECES } from "./constants";
import { generatePlacementsForPiece } from "./placements";
import { MutableNoodlesBoard } from "./mutable-board";
import type { PiecePlacement } from "./types";

export interface NoodlesSolverResult {
  solved: boolean;
  solution: (PiecePlacement | null)[];
  timeMs: number;
  statesExplored: number;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 5000;
const NUM_PIECES = IQ_NOODLES_PIECES.length;
const TOTAL_CELLS = BOARD_WIDTH * BOARD_HEIGHT;

export function solve(
  initialPlacements?: Map<number, PiecePlacement>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): NoodlesSolverResult {
  const t0 = performance.now();
  const deadline = t0 + timeoutMs;
  const board = new MutableNoodlesBoard();

  const placed = new Set<number>();
  const solution: (PiecePlacement | null)[] = new Array(NUM_PIECES).fill(null);

  if (initialPlacements) {
    for (const [pieceId, placement] of initialPlacements) {
      board.place(placement.positions, pieceId);
      placed.add(pieceId);
      solution[pieceId] = placement;
    }
  }

  const unplacedList: number[] = [];
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i)) unplacedList.push(i);
  }

  // Pre-generate all placements for unplaced pieces.
  const allPlacements: Record<number, PiecePlacement[]> = {};
  for (const pieceId of unplacedList) {
    allPlacements[pieceId] = generatePlacementsForPiece(pieceId);
  }

  // Build cell → placements index: for each valid board cell, which (piece, placement)
  // pairs cover it? Used by cell-level MRV to pick the most constrained cell first.
  type CoverEntry = { pieceId: number; placement: PiecePlacement };
  const cellCoverage: CoverEntry[][] = new Array(TOTAL_CELLS).fill(null).map(() => []);
  for (const pieceId of unplacedList) {
    for (const placement of allPlacements[pieceId]) {
      for (const cell of placement.positions) {
        cellCoverage[cell].push({ pieceId, placement });
      }
    }
  }

  let statesExplored = 0;
  let timedOut = false;
  const remaining = new Set<number>(unplacedList);

  // Cell-level MRV backtracker (Algorithm X style):
  // At each step, find the free cell with fewest covering options from remaining pieces,
  // then try each covering placement. This gives a much tighter branching factor than
  // piece-level MRV on a board this sparse.
  function backtrack(): boolean {
    if (remaining.size === 0) return true;
    if (performance.now() > deadline) {
      timedOut = true;
      return false;
    }
    statesExplored++;

    // Pick the most constrained uncovered cell.
    let bestOptions: CoverEntry[] = [];
    let bestCount = Infinity;

    for (let cell = 0; cell < TOTAL_CELLS; cell++) {
      if (!board.isCellFree(cell)) continue;

      const options: CoverEntry[] = [];
      for (const entry of cellCoverage[cell]) {
        if (remaining.has(entry.pieceId) && board.areCellsFree(entry.placement.positions)) {
          options.push(entry);
        }
      }

      if (options.length === 0) return false; // cell can never be covered → dead end
      if (options.length < bestCount) {
        bestCount = options.length;
        bestOptions = options;
        if (bestCount === 1) break; // can't do better
      }
    }

    for (const { pieceId, placement } of bestOptions) {
      board.place(placement.positions, pieceId);
      solution[pieceId] = placement;
      remaining.delete(pieceId);

      if (backtrack()) return true;

      board.remove(placement.positions);
      solution[pieceId] = null;
      remaining.add(pieceId);
    }

    return false;
  }

  const solved = backtrack();
  return {
    solved,
    solution,
    timeMs: performance.now() - t0,
    statesExplored,
    timedOut,
  };
}

export interface NoodlesValidationResult {
  /** The current partial placement has no conflicts (always true if placements are built via the UI). */
  placementsValid: boolean;
  /** Whether the solver found a completion from the current state within the time limit. */
  solvable: boolean | null; // null = timed out, couldn't determine
  timeMs: number;
}

/**
 * Validates the current board state: checks for conflicts and whether a solution
 * still exists. Uses a short timeout — if the solver can't decide in time, returns
 * solvable: null (indeterminate).
 */
export function validate(
  currentPlacements: Map<number, PiecePlacement>,
  timeoutMs = 2000,
): NoodlesValidationResult {
  const t0 = performance.now();

  // Check for position conflicts among placed pieces.
  const seen = new Set<number>();
  for (const placement of currentPlacements.values()) {
    for (const pos of placement.positions) {
      if (seen.has(pos)) {
        return { placementsValid: false, solvable: false, timeMs: performance.now() - t0 };
      }
      seen.add(pos);
    }
  }

  const result = solve(currentPlacements, timeoutMs);
  const solvable = result.timedOut ? null : result.solved;
  return {
    placementsValid: true,
    solvable,
    timeMs: performance.now() - t0,
  };
}

export function getHint(
  initialPlacements?: Map<number, PiecePlacement>,
): { pieceId: number; placement: PiecePlacement; fullResult: NoodlesSolverResult } | null {
  const result = solve(initialPlacements, 5000);
  if (!result.solved) return null;

  const placed = initialPlacements ? new Set(initialPlacements.keys()) : new Set<number>();
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i) && result.solution[i]) {
      return { pieceId: i, placement: result.solution[i]!, fullResult: result };
    }
  }
  return null;
}

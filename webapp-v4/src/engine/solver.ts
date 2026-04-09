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

export interface NoodlesValidationResult {
  /** The current partial placement has no conflicts. */
  placementsValid: boolean;
  /** Whether a full solution exists from the current state within the time limit. */
  solvable: boolean | null; // null = timed out, indeterminate
  timeMs: number;
}

const DEFAULT_SOLVE_TIMEOUT_MS = 5000;
const DEFAULT_VALIDATE_TIMEOUT_MS = 2000;
const NUM_PIECES = IQ_NOODLES_PIECES.length;
const TOTAL_CELLS = BOARD_WIDTH * BOARD_HEIGHT;

export function solve(
  initialPlacements?: Map<number, PiecePlacement>,
  timeoutMs = DEFAULT_SOLVE_TIMEOUT_MS,
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

  // Cell-coverage index: for each board cell, which (piece, placement) pairs cover it.
  // Used by cell-level MRV to pick the most constrained free cell at each step —
  // tighter branching factor than piece-level MRV on a sparse board like this.
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

  function backtrack(): boolean {
    if (remaining.size === 0) return true;
    if (performance.now() > deadline) {
      timedOut = true;
      return false;
    }
    statesExplored++;

    // Pick the free cell with the fewest covering options (MRV).
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

      if (options.length === 0) return false; // dead end: cell can never be covered
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

/**
 * Validates the current board state: checks for position conflicts among placed
 * pieces, then tries to find a full solution within the time limit.
 */
export function validate(
  currentPlacements: Map<number, PiecePlacement>,
  timeoutMs = DEFAULT_VALIDATE_TIMEOUT_MS,
): NoodlesValidationResult {
  const t0 = performance.now();

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

/**
 * Solves from the current state and returns the first unplaced piece from the
 * solution — the "hint" the user should place next.
 */
export function getHint(
  initialPlacements?: Map<number, PiecePlacement>,
): { pieceId: number; placement: PiecePlacement; fullResult: NoodlesSolverResult } | null {
  const result = solve(initialPlacements, DEFAULT_SOLVE_TIMEOUT_MS);
  if (!result.solved) return null;

  const placed = initialPlacements ? new Set(initialPlacements.keys()) : new Set<number>();
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i) && result.solution[i]) {
      return { pieceId: i, placement: result.solution[i]!, fullResult: result };
    }
  }
  return null;
}

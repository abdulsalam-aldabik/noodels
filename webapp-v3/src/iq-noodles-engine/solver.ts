import { IQ_NOODLES_PIECES } from "./constants";
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

  const unplaced: number[] = [];
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i)) unplaced.push(i);
  }

  const allPlacements: Record<number, PiecePlacement[]> = {};
  for (const pieceId of unplaced) {
    allPlacements[pieceId] = generatePlacementsForPiece(pieceId);
  }

  let statesExplored = 0;
  let timedOut = false;

  function backtrack(remaining: number[]): boolean {
    if (remaining.length === 0) return true;
    if (performance.now() > deadline) {
      timedOut = true;
      return false;
    }
    statesExplored++;

    let bestPiece = -1;
    let bestPlacements: PiecePlacement[] = [];
    let bestCount = Infinity;

    for (const pieceId of remaining) {
      const available = allPlacements[pieceId].filter((p) =>
        board.areCellsFree(p.positions),
      );
      if (available.length === 0) return false;
      if (available.length < bestCount) {
        bestCount = available.length;
        bestPiece = pieceId;
        bestPlacements = available;
      }
    }

    if (bestPiece === -1) return false;
    const next = remaining.filter((p) => p !== bestPiece);

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
  return {
    solved,
    solution,
    timeMs: performance.now() - t0,
    statesExplored,
    timedOut,
  };
}

export function getHint(
  initialPlacements?: Map<number, PiecePlacement>,
): { pieceId: number; placement: PiecePlacement; fullResult: NoodlesSolverResult } | null {
  const result = solve(initialPlacements, 3000);
  if (!result.solved) return null;

  const placed = initialPlacements ? new Set(initialPlacements.keys()) : new Set<number>();
  for (let i = 0; i < NUM_PIECES; i++) {
    if (!placed.has(i) && result.solution[i]) {
      return { pieceId: i, placement: result.solution[i]!, fullResult: result };
    }
  }
  return null;
}

import { BOARD_WIDTH } from "../engine/constants";
import type { PieceCandidate } from "../vision/visionTypes";

/**
 * Encodes a cell [row, col] as a unique key for collision checking.
 */
function cellKey(row: number, col: number): number {
  return row * BOARD_WIDTH + col;
}

interface AssignmentState {
  assignment: Map<number, PieceCandidate>;
  totalScore: number;
  occupiedCells: Set<number>;
}

/**
 * Solves joint piece-to-cell assignment with no-overlap constraint.
 *
 * Uses branch-and-bound: tries each piece's top-K candidates,
 * prunes branches whose upper bound can't beat the current best,
 * and skips candidates that collide with already-assigned cells.
 *
 * A piece may be left unassigned if all its candidates conflict.
 */
export function globalAssign(
  candidatesByPiece: Map<number, PieceCandidate[]>,
): Map<number, PieceCandidate> {
  const pieceIds = [...candidatesByPiece.keys()];
  if (pieceIds.length === 0) return new Map();

  // Upper bound per piece = best candidate score
  const maxScorePerPiece = new Map<number, number>();
  for (const [id, cands] of candidatesByPiece) {
    maxScorePerPiece.set(id, cands.length > 0 ? cands[0].score : 0);
  }

  let bestState: AssignmentState = {
    assignment: new Map(),
    totalScore: 0,
    occupiedCells: new Set(),
  };

  const TIMEOUT_MS = 50; // Keep it fast — this runs on the UI thread
  const deadline = performance.now() + TIMEOUT_MS;

  function branchAndBound(
    idx: number,
    current: AssignmentState,
  ): void {
    if (performance.now() > deadline) return;

    if (idx >= pieceIds.length) {
      if (current.totalScore > bestState.totalScore) {
        bestState = {
          assignment: new Map(current.assignment),
          totalScore: current.totalScore,
          occupiedCells: new Set(current.occupiedCells),
        };
      }
      return;
    }

    // Upper bound: current score + max possible from remaining pieces
    let upperBound = current.totalScore;
    for (let j = idx; j < pieceIds.length; j++) {
      upperBound += maxScorePerPiece.get(pieceIds[j]) ?? 0;
    }
    if (upperBound <= bestState.totalScore) return; // prune

    const pieceId = pieceIds[idx];
    const candidates = candidatesByPiece.get(pieceId) ?? [];

    // Try assigning each candidate
    for (const cand of candidates) {
      const key = cellKey(cand.cell[0], cand.cell[1]);
      if (current.occupiedCells.has(key)) continue; // collision

      current.assignment.set(pieceId, cand);
      current.totalScore += cand.score;
      current.occupiedCells.add(key);

      branchAndBound(idx + 1, current);

      current.assignment.delete(pieceId);
      current.totalScore -= cand.score;
      current.occupiedCells.delete(key);
    }

    // Try skipping this piece (leave unassigned)
    branchAndBound(idx + 1, current);
  }

  branchAndBound(0, {
    assignment: new Map(),
    totalScore: 0,
    occupiedCells: new Set(),
  });

  return bestState.assignment;
}

import type { PiecePlacement } from "../engine/types";

export type Cell = [number, number];

export interface Candidate {
  pieceId: number;
  pieceKey: string;
  anchorCell: Cell;
  orientationDeg: 0 | 90 | 180 | 270;
  footprint: Cell[];
  score: number;
  placement: PiecePlacement;
}

function cellKey([row, col]: Cell): number {
  return row * 100 + col;
}

function footprintCollides(footprint: Cell[], occupied: Set<number>): boolean {
  for (const cell of footprint) {
    if (occupied.has(cellKey(cell))) return true;
  }
  return false;
}

function occupy(footprint: Cell[], occupied: Set<number>): void {
  for (const cell of footprint) occupied.add(cellKey(cell));
}

function release(footprint: Cell[], occupied: Set<number>): void {
  for (const cell of footprint) occupied.delete(cellKey(cell));
}

/**
 * Branch-and-bound assignment across all pieces.
 *
 * Maximizes total candidate score under no-overlap constraints.
 */
export function globalAssign(
  candidatesByPiece: Map<number, Candidate[]>,
  occupiedCells = new Set<number>(),
): Map<number, Candidate> {
  if (candidatesByPiece.size === 0) return new Map();

  const pieces = [...candidatesByPiece.keys()].sort((a, b) => {
    const ac = candidatesByPiece.get(a)?.length ?? 0;
    const bc = candidatesByPiece.get(b)?.length ?? 0;
    return ac - bc;
  });

  const maxByPiece = pieces.map((pieceId) => {
    const cands = candidatesByPiece.get(pieceId) ?? [];
    return cands.length > 0 ? Math.max(...cands.map((c) => c.score)) : 0;
  });

  const optimistic = new Array<number>(pieces.length + 1).fill(0);
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    optimistic[i] = optimistic[i + 1] + maxByPiece[i];
  }

  let bestTotal = Number.NEGATIVE_INFINITY;
  let bestAssignment = new Map<number, Candidate>();
  const current = new Map<number, Candidate>();
  const occupied = new Set<number>(occupiedCells);

  const branch = (idx: number, score: number): void => {
    if (idx === pieces.length) {
      if (score > bestTotal) {
        bestTotal = score;
        bestAssignment = new Map(current);
      }
      return;
    }

    if (score + optimistic[idx] <= bestTotal + 1e-9) return;

    const pieceId = pieces[idx];
    const pieceCandidates = candidatesByPiece.get(pieceId) ?? [];

    for (const cand of pieceCandidates) {
      if (footprintCollides(cand.footprint, occupied)) continue;

      occupy(cand.footprint, occupied);
      current.set(pieceId, cand);
      branch(idx + 1, score + cand.score);
      current.delete(pieceId);
      release(cand.footprint, occupied);
    }

    // Allow piece to stay unassigned when all placements are weak/conflicting.
    branch(idx + 1, score);
  };

  branch(0, 0);
  return bestAssignment;
}

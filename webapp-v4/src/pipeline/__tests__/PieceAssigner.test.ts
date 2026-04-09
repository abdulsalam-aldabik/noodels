import { describe, expect, it } from "vitest";
import type { PiecePlacement } from "../../engine/types";
import { globalAssign, type Candidate } from "../PieceAssigner";

function placement(pieceId: number, positions: number[]): PiecePlacement {
  return {
    pieceId,
    orientationIndex: 0,
    positions,
    shapes: new Array(positions.length).fill(0),
    rotationSteps: 0,
    mirrored: false,
  };
}

function candidate(
  pieceId: number,
  anchorCell: [number, number],
  footprint: [number, number][],
  score: number,
): Candidate {
  return {
    pieceId,
    pieceKey: `piece_${pieceId}`,
    anchorCell,
    orientationDeg: 0,
    footprint,
    score,
    placement: placement(pieceId, footprint.map(([row, col]) => row * 14 + col)),
  };
}

describe("globalAssign", () => {
  it("chooses non-overlapping combination with highest global score", () => {
    const candidates = new Map<number, Candidate[]>([
      [0, [
        candidate(0, [2, 2], [[2, 2], [2, 3]], 0.9),
        candidate(0, [4, 4], [[4, 4], [4, 5]], 0.7),
      ]],
      [1, [
        candidate(1, [2, 2], [[2, 2], [3, 2]], 0.95),
        candidate(1, [6, 6], [[6, 6], [6, 7]], 0.6),
      ]],
    ]);

    const assignment = globalAssign(candidates);

    expect(assignment.size).toBe(2);
    expect(assignment.get(0)?.anchorCell).toEqual([4, 4]);
    expect(assignment.get(1)?.anchorCell).toEqual([2, 2]);
  });

  it("can leave a piece unassigned when all its candidates collide", () => {
    const candidates = new Map<number, Candidate[]>([
      [0, [candidate(0, [1, 1], [[1, 1], [1, 2]], 0.7)]],
      [1, [candidate(1, [1, 1], [[1, 1], [2, 1]], 0.8)]],
    ]);

    const assignment = globalAssign(candidates);

    expect(assignment.size).toBe(1);
  });
});

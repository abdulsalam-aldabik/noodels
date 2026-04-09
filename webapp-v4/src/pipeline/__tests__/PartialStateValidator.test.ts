import { describe, expect, it } from "vitest";
import { BOARD_WIDTH } from "../../engine/constants";
import { generatePlacementsForPiece } from "../../engine/placements";
import type { PiecePlacement } from "../../engine/types";
import type { MappedPiecePlacement } from "../../vision/visionTypes";
import { validatePartialState } from "../PartialStateValidator";

function posToCell(pos: number): [number, number] {
  return [Math.floor(pos / BOARD_WIDTH), pos % BOARD_WIDTH];
}

function findCommonCellPos(pieceA: number, pieceB: number): number {
  const aPositions = new Set<number>(
    generatePlacementsForPiece(pieceA).flatMap((p) => p.positions),
  );

  for (const placement of generatePlacementsForPiece(pieceB)) {
    for (const pos of placement.positions) {
      if (aPositions.has(pos)) return pos;
    }
  }

  throw new Error(`No common cell found between pieces ${pieceA} and ${pieceB}`);
}

function findPlacementCovering(pieceId: number, pos: number): PiecePlacement {
  const placement = generatePlacementsForPiece(pieceId).find((p) => p.positions.includes(pos));
  if (!placement) {
    throw new Error(`No placement for piece ${pieceId} covers cell ${pos}`);
  }
  return placement;
}

function placementBoardCentroid(placement: PiecePlacement): [number, number] {
  let sumRow = 0;
  let sumCol = 0;

  for (const pos of placement.positions) {
    const [row, col] = posToCell(pos);
    sumRow += row;
    sumCol += col;
  }

  return [sumCol / placement.positions.length, sumRow / placement.positions.length];
}

function boardMaskFromPlacement(placement: PiecePlacement): [number, number][] {
  return placement.positions.map((pos) => {
    const [row, col] = posToCell(pos);
    return [col, row];
  });
}

function mappedFromPlacement(
  pieceId: number,
  pieceKey: string,
  candidatePos: number,
  placement: PiecePlacement,
  detectionConfidence: number,
  cellConfidence: number,
): MappedPiecePlacement {
  const [row, col] = posToCell(candidatePos);

  return {
    modelClassId: pieceId,
    classId: pieceId,
    pieceKey,
    detectionConfidence,
    imageCentroid: [0, 0],
    boardCentroid: placementBoardCentroid(placement),
    boardMaskPoints: boardMaskFromPlacement(placement),
    candidateCell: [row, col],
    cellConfidence,
    ambiguous: false,
    alternativeCells: [],
  };
}

describe("validatePartialState", () => {
  it("marks mapped pieces as dropped when assignment is empty", () => {
    const sharedPos = findCommonCellPos(0, 1);
    const placement = findPlacementCovering(0, sharedPos);

    const mapped = mappedFromPlacement(0, "J", sharedPos, placement, 0.95, 0.2);
    const { report, confirmedPlacements } = validatePartialState([mapped], new Map());

    expect(confirmedPlacements.size).toBe(0);
    expect(report.droppedPieces).toContain(0);
    expect(report.valid).toBe(false);
  });

  it("reports conflicts when assigned placements overlap", () => {
    const sharedPos = findCommonCellPos(0, 1);
    const p0 = findPlacementCovering(0, sharedPos);
    const p1 = findPlacementCovering(1, sharedPos);

    const strong = mappedFromPlacement(0, "J", sharedPos, p0, 0.96, 0.92);
    const weak = mappedFromPlacement(1, "C", sharedPos, p1, 0.52, 0.45);

    const assigned = new Map<number, PiecePlacement>([
      [0, p0],
      [1, p1],
    ]);

    const { report, confirmedPlacements } = validatePartialState([strong, weak], assigned);

    expect(confirmedPlacements.size).toBe(2);
    expect(confirmedPlacements.has(0)).toBe(true);
    expect(report.droppedPieces.length).toBe(0);
    expect(report.conflicts.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Tests for the placement-finding logic from usePlacementFinder.
 *
 * We call the engine directly to build placement fixtures, then test
 * getFreePlacements and findBestPlacement against known board states.
 */

import { describe, expect, test } from "vitest";

import { NoodlesBoard } from "../../engine/board";
import { generatePlacementsForPiece } from "../../engine/placements";
import { BoardCoordinator } from "../../board/BoardCoordinator";
import type { PiecePlacement } from "../../engine/types";

// ─── Pure logic extracted from usePlacementFinder ───────────────────────────

function getFreePlacements(
  placementsByPiece: Record<number, PiecePlacement[]>,
  pieceId: number,
  occupiedByOthers: Set<number>,
): PiecePlacement[] {
  return placementsByPiece[pieceId].filter((p) =>
    p.positions.every((pos) => !occupiedByOthers.has(pos)),
  );
}

function findBestPlacement(
  placementsByPiece: Record<number, PiecePlacement[]>,
  coordinator: BoardCoordinator,
  pieceId: number,
  orientationIndex: number,
  targetRow: number,
  targetCol: number,
  occupiedByOthers: Set<number>,
  allowOrientationFallback = false,
): PiecePlacement | null {
  const free = getFreePlacements(placementsByPiece, pieceId, occupiedByOthers);
  const sameOrientation = free.filter((p) => p.orientationIndex === orientationIndex);
  const pool = sameOrientation.length > 0 || !allowOrientationFallback ? sameOrientation : free;

  if (pool.length === 0) return null;

  let best: PiecePlacement | null = null;
  let bestScore = Infinity;
  for (const placement of pool) {
    let sumRow = 0, sumCol = 0;
    for (const pos of placement.positions) {
      const [r, c] = coordinator.toRowCol(pos);
      sumRow += r; sumCol += c;
    }
    const centerRow = sumRow / placement.positions.length;
    const centerCol = sumCol / placement.positions.length;
    const score = (centerRow - targetRow) ** 2 + (centerCol - targetCol) ** 2;
    if (score < bestScore) { bestScore = score; best = placement; }
  }
  return best;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const board = new NoodlesBoard();
const coordinator = new BoardCoordinator(14, 14);

const placementsByPiece: Record<number, PiecePlacement[]> = {};
for (let id = 0; id < 11; id++) {
  placementsByPiece[id] = generatePlacementsForPiece(id, board);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getFreePlacements", () => {
  test("returns all placements when board is empty", () => {
    const free = getFreePlacements(placementsByPiece, 0, new Set());
    expect(free.length).toBe(placementsByPiece[0].length);
  });

  test("filters out placements that overlap occupied cells", () => {
    // Occupy a cell that every placement for piece 0 must cover
    const firstPlacement = placementsByPiece[0][0];
    const occupiedCell = firstPlacement.positions[0];
    const occupied = new Set([occupiedCell]);

    const free = getFreePlacements(placementsByPiece, 0, occupied);
    const blocked = getFreePlacements(
      { 0: placementsByPiece[0].filter((p) => p.positions.includes(occupiedCell)) },
      0,
      occupied,
    );

    expect(free.length).toBeLessThan(placementsByPiece[0].length);
    expect(blocked).toHaveLength(0);
  });

  test("returns empty array when all placements are blocked", () => {
    // Occupy all valid board cells
    const allCells = new Set<number>();
    for (let pos = 0; pos < board.width * board.height; pos++) {
      if (board.isFree(pos)) allCells.add(pos);
    }
    const free = getFreePlacements(placementsByPiece, 0, allCells);
    expect(free).toHaveLength(0);
  });
});

describe("findBestPlacement", () => {
  test("returns null when no free placements exist for the given orientation", () => {
    const allCells = new Set<number>();
    for (let pos = 0; pos < board.width * board.height; pos++) {
      if (board.isFree(pos)) allCells.add(pos);
    }
    const result = findBestPlacement(placementsByPiece, coordinator, 0, 0, 6, 6, allCells);
    expect(result).toBeNull();
  });

  test("returns null without fallback when no orientation-matching placement exists", () => {
    // Use a non-existent orientation index — no matches, no fallback
    const result = findBestPlacement(
      placementsByPiece, coordinator,
      0, 999, 6, 6, new Set(), false,
    );
    expect(result).toBeNull();
  });

  test("falls back to any orientation when allowOrientationFallback is true", () => {
    // Use a non-existent orientation index but allow fallback
    const result = findBestPlacement(
      placementsByPiece, coordinator,
      0, 999, 6, 6, new Set(), true,
    );
    expect(result).not.toBeNull();
  });

  test("returns the placement whose center is closest to the target", () => {
    // Pick orientation index 0 and find all free placements with that orientation
    const oi = 0;
    const freeSameOrientation = getFreePlacements(placementsByPiece, 0, new Set())
      .filter((p) => p.orientationIndex === oi);

    if (freeSameOrientation.length < 2) return; // not enough variety to test

    // Pick a target near the first placement's center
    const first = freeSameOrientation[0];
    const avgRow = first.positions.reduce((s, p) => s + Math.floor(p / 14), 0) / first.positions.length;
    const avgCol = first.positions.reduce((s, p) => s + (p % 14), 0) / first.positions.length;

    const result = findBestPlacement(
      placementsByPiece, coordinator, 0, oi, avgRow, avgCol, new Set(),
    );
    expect(result).not.toBeNull();

    // The result's center should be closer to (avgRow, avgCol) than any other placement
    const resultRow = result!.positions.reduce((s, p) => s + Math.floor(p / 14), 0) / result!.positions.length;
    const resultCol = result!.positions.reduce((s, p) => s + (p % 14), 0) / result!.positions.length;
    const resultScore = (resultRow - avgRow) ** 2 + (resultCol - avgCol) ** 2;

    for (const p of freeSameOrientation) {
      const pRow = p.positions.reduce((s, pos) => s + Math.floor(pos / 14), 0) / p.positions.length;
      const pCol = p.positions.reduce((s, pos) => s + (pos % 14), 0) / p.positions.length;
      const pScore = (pRow - avgRow) ** 2 + (pCol - avgCol) ** 2;
      expect(resultScore).toBeLessThanOrEqual(pScore);
    }
  });
});

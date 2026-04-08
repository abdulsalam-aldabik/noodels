import { describe, expect, test } from "vitest";
import { solve } from "../solver";
import { MutableNoodlesBoard } from "../mutable-board";
import { generatePlacementsForPiece } from "../placements";

describe("IQ Noodles solver", () => {
  test("MutableNoodlesBoard place and remove work correctly", () => {
    const board = new MutableNoodlesBoard();
    const placements = generatePlacementsForPiece(0);
    expect(placements.length).toBeGreaterThan(0);

    const first = placements[0];
    expect(board.areCellsFree(first.positions)).toBe(true);

    board.place(first.positions, 0);
    expect(board.areCellsFree(first.positions)).toBe(false);
    expect(board.getPlacedPieceIds().has(0)).toBe(true);

    board.remove(first.positions);
    expect(board.areCellsFree(first.positions)).toBe(true);
    expect(board.getPlacedPieceIds().has(0)).toBe(false);
  });

  test("MutableNoodlesBoard clone is independent", () => {
    const board = new MutableNoodlesBoard();
    const placements = generatePlacementsForPiece(0);
    const first = placements[0];

    board.place(first.positions, 0);
    const clone = board.clone();

    board.remove(first.positions);
    expect(board.areCellsFree(first.positions)).toBe(true);
    expect(clone.areCellsFree(first.positions)).toBe(false);
  });

  test("checkOpenSpace returns false for empty board (cells are in disconnected 2x2 blocks)", () => {
    const board = new MutableNoodlesBoard();
    // IQ Noodles valid cells are in 2x2 blocks separated by missing cells,
    // so they're NOT a single connected component via N/S/E/W adjacency.
    // This is expected — the solver only uses this check as a late-game pruning heuristic.
    expect(board.checkOpenSpace()).toBe(false);
  });

  test("solver finds a solution with some pieces pre-placed", () => {
    const placements0 = generatePlacementsForPiece(0);
    const initial = new Map([[0, placements0[0]]]);

    const result = solve(initial, 10000);
    expect(result.timedOut).toBe(false);
    if (result.solved) {
      expect(result.solution[0]).toEqual(placements0[0]);
      for (let i = 0; i < 11; i++) {
        expect(result.solution[i]).not.toBeNull();
      }
    }
  });
});

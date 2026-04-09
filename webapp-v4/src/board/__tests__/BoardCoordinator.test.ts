import { describe, expect, test } from "vitest";

import { BoardCoordinator } from "../BoardCoordinator";

describe("BoardCoordinator", () => {
  const coordinator = new BoardCoordinator(14, 14);

  test("computes board geometry constants", () => {
    expect(coordinator.cellSize).toBe(28);
    expect(coordinator.boardPadding).toBe(40);
    expect(coordinator.boardSize).toBe(444);
    expect(coordinator.halfBoard).toBe(222);
  });

  test("maps linear position to row and column", () => {
    expect(coordinator.toRowCol(0)).toEqual([0, 0]);
    expect(coordinator.toRowCol(13)).toEqual([0, 13]);
    expect(coordinator.toRowCol(14)).toEqual([1, 0]);
    expect(coordinator.toRowCol(191)).toEqual([13, 9]);
  });

  test("converts row/col to board point and back", () => {
    const boardPoint = coordinator.rowColToBoardPoint(6, 8);
    expect(boardPoint).toEqual({ x: 264, y: 208 });

    const rowCol = coordinator.boardPointToRowCol(boardPoint);
    expect(rowCol.row).toBeCloseTo(6, 6);
    expect(rowCol.col).toBeCloseTo(8, 6);
  });

  test("maps DOM coordinates into board space", () => {
    const point = coordinator.domToBoardPoint(300, 250, 100, 50, 444, 444);
    expect(point.x).toBeCloseTo(200, 6);
    expect(point.y).toBeCloseTo(200, 6);
  });

  test("maps row/col to world coordinates for 3D scene", () => {
    const world = coordinator.rowColToWorldPoint(0, 0);
    expect(world).toEqual({ x: -182, y: 182, z: 0.02 });

    const centerWorld = coordinator.rowColToWorldPoint(6.5, 6.5, 0.5);
    expect(centerWorld).toEqual({ x: 0, y: 0, z: 0.5 });
  });
});
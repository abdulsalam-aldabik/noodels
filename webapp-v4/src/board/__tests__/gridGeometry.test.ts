import { describe, expect, it } from "vitest";

import {
  BOARD_EDGE_MAX,
  BOARD_EDGE_MIN,
  BOARD_EDGE_SPAN,
  GRID,
  boardToCanvas,
  canvasToBoard,
  computePinBoardPoints,
  expectedCellSpacingPx,
  snapToCell,
} from "../gridGeometry";

describe("gridGeometry invariants", () => {
  it("GRID is 14 and edge span equals 14", () => {
    expect(GRID).toBe(14);
    expect(BOARD_EDGE_SPAN).toBe(14);
    expect(BOARD_EDGE_MIN).toBe(-0.5);
    expect(BOARD_EDGE_MAX).toBe(13.5);
  });

  it("expectedCellSpacingPx returns canvasSize / 14", () => {
    expect(expectedCellSpacingPx(560)).toBeCloseTo(40, 9);
    expect(expectedCellSpacingPx(700)).toBeCloseTo(50, 9);
  });
});

describe("boardToCanvas / canvasToBoard", () => {
  const canvas = 560;

  it("maps top-left edge corner to (0,0)", () => {
    const p = boardToCanvas(BOARD_EDGE_MIN, BOARD_EDGE_MIN, canvas);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it("maps bottom-right edge corner to (canvas, canvas)", () => {
    const p = boardToCanvas(BOARD_EDGE_MAX, BOARD_EDGE_MAX, canvas);
    expect(p.x).toBeCloseTo(canvas, 9);
    expect(p.y).toBeCloseTo(canvas, 9);
  });

  it("maps cell (0,0) center to one half-cell inside", () => {
    const p = boardToCanvas(0, 0, canvas);
    const half = expectedCellSpacingPx(canvas) / 2;
    expect(p.x).toBeCloseTo(half, 9);
    expect(p.y).toBeCloseTo(half, 9);
  });

  it("round-trips for arbitrary board coords", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [7, 3],
      [13, 13],
      [6.25, 2.75],
      [-0.5, 13.5],
    ];
    for (const [bx, by] of cases) {
      const c = boardToCanvas(bx, by, canvas);
      const back = canvasToBoard(c.x, c.y, canvas);
      expect(back.x).toBeCloseTo(bx, 9);
      expect(back.y).toBeCloseTo(by, 9);
    }
  });
});

describe("snapToCell", () => {
  it("clamps to grid bounds", () => {
    expect(snapToCell(-5, -5)).toEqual({ col: 0, row: 0 });
    expect(snapToCell(99, 99)).toEqual({ col: 13, row: 13 });
  });

  it("rounds to nearest integer cell", () => {
    expect(snapToCell(3.4, 7.6)).toEqual({ col: 3, row: 8 });
  });
});

describe("computePinBoardPoints", () => {
  it("returns 21 pin locations in-bounds", () => {
    const pins = computePinBoardPoints();
    expect(pins).toHaveLength(21);
    for (const p of pins) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(GRID - 1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(GRID - 1);
    }
  });

  it("pin centers fall at half-integer cell corners", () => {
    const pins = computePinBoardPoints();
    for (const p of pins) {
      // Each pin sits at the shared corner of 4 cells → .5 offset in both axes.
      expect(Math.abs((p.x * 2) % 1)).toBeLessThan(1e-9);
      expect(Math.abs((p.y * 2) % 1)).toBeLessThan(1e-9);
    }
  });
});

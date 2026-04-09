import { describe, expect, test } from "vitest";

import { NoodlesBoard } from "../board";
import { IQ_NOODLES_PIECES, POSITIONS_AROUND_PINS } from "../constants";
import { findAllOrientations, ROTATION_SHAPE_MAP, REFLECTION_SHAPE_MAP } from "../orientation";
import { generatePlacementsForAllPieces, generatePlacementsForPiece } from "../placements";
import { SegmentShape } from "../types";

describe("IQ Noodles Java parity baseline", () => {
  test("board constants match Java model", () => {
    const board = new NoodlesBoard();

    expect(board.width).toBe(14);
    expect(board.height).toBe(14);
    expect(board.getValidCellCount()).toBe(84);
    expect(POSITIONS_AROUND_PINS.length).toBe(21);

    POSITIONS_AROUND_PINS.forEach((positions) => {
      expect(positions.length).toBe(4);
      expect(board.areFree([...positions])).toBe(true);
    });
  });

  test("piece inventory lengths match Java pieces", () => {
    const lengths = IQ_NOODLES_PIECES.map((piece) => piece.bigGridPositions.length);
    expect(lengths).toEqual([6, 6, 6, 8, 8, 8, 8, 8, 8, 10, 8]);
  });

  test("shape remap tables preserve curve and swap cross directions", () => {
    ROTATION_SHAPE_MAP.forEach((map) => {
      expect(map[SegmentShape.CURVE]).toBe(SegmentShape.CURVE);
      expect(map[SegmentShape.CROSS_NS]).toBeTypeOf("number");
      expect(map[SegmentShape.CROSS_EW]).toBeTypeOf("number");
    });

    expect(ROTATION_SHAPE_MAP[0][SegmentShape.CROSS_NS]).toBe(SegmentShape.CROSS_EW);
    expect(ROTATION_SHAPE_MAP[0][SegmentShape.CROSS_EW]).toBe(SegmentShape.CROSS_NS);
    expect(ROTATION_SHAPE_MAP[1][SegmentShape.CROSS_NS]).toBe(SegmentShape.CROSS_NS);
    expect(ROTATION_SHAPE_MAP[1][SegmentShape.CROSS_EW]).toBe(SegmentShape.CROSS_EW);

    expect(REFLECTION_SHAPE_MAP[SegmentShape.CROSS_NS]).toBe(SegmentShape.CROSS_EW);
    expect(REFLECTION_SHAPE_MAP[SegmentShape.CROSS_EW]).toBe(SegmentShape.CROSS_NS);
  });

  test("orientation generation returns deduplicated canonical orientations", () => {
    const piece0 = IQ_NOODLES_PIECES[0];
    const orientations = findAllOrientations(piece0);

    expect(orientations.length).toBeGreaterThan(0);
    expect(orientations.length).toBeLessThanOrEqual(8);

    const signatures = new Set(
      orientations.map((o) => `${o.positions.join(",")}|${o.shapes.join(",")}`),
    );
    expect(signatures.size).toBe(orientations.length);

    const baseSignature = "2,42,80,81,120,121|0,2,0,2,0,0";
    expect(signatures.has(baseSignature)).toBe(true);
  });

  test("placement generator creates only legal placements on board mask", () => {
    const board = new NoodlesBoard();
    const placements = generatePlacementsForPiece(0, board);

    expect(placements.length).toBeGreaterThan(0);

    placements.forEach((placement) => {
      expect(placement.positions.length).toBe(IQ_NOODLES_PIECES[0].bigGridPositions.length);
      expect(board.areFree(placement.positions)).toBe(true);
    });
  });

  test("all pieces have at least one legal placement", () => {
    const allPlacements = generatePlacementsForAllPieces();
    expect(allPlacements).toHaveLength(IQ_NOODLES_PIECES.length);
    allPlacements.forEach((piecePlacements) => {
      expect(piecePlacements.length).toBeGreaterThan(0);
    });
  });
});

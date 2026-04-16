import { describe, expect, it } from "vitest";

import {
  BOARD_CLASS_ID,
  HINGE_CLASS_ID,
  type RawDetection,
} from "../../inference/types";
import { locateBoard } from "../BoardLocator";

const IMAGE_SIZE = { width: 1280, height: 720 };

interface BoardDetectionOptions {
  score?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  withMask?: boolean;
}

function makeBoardDetection(options: BoardDetectionOptions = {}): RawDetection {
  const {
    score = 0.9,
    x = 120,
    y = 80,
    width = 500,
    height = 500,
    withMask = true,
  } = options;
  return {
    classId: BOARD_CLASS_ID,
    className: "board",
    score,
    bbox: { x, y, width, height },
    mask: withMask
      ? {
          width: 20,
          height: 20,
          data: new Uint8Array(20 * 20).fill(1),
        }
      : undefined,
  };
}

function makeHingeDetection(): RawDetection {
  return {
    classId: HINGE_CLASS_ID,
    className: "hinge",
    score: 0.92,
    bbox: { x: 320, y: 92, width: 140, height: 24 },
  };
}

describe("locateBoard", () => {
  it("returns failed status when no board detection exists", () => {
    const result = locateBoard(
      [
        {
          classId: 0,
          className: "A",
          score: 0.8,
          bbox: { x: 200, y: 160, width: 80, height: 80 },
        },
      ],
      IMAGE_SIZE,
    );

    expect(result.status).toBe("failed");
    expect(result.message).toContain("no board");
    expect(result.cornerScore).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("picks the highest-confidence board detection", () => {
    const lowScoreBoard = makeBoardDetection({
      score: 0.6,
      x: 40,
      y: 120,
      width: 220,
      height: 220,
      withMask: false,
    });
    const highScoreBoard = makeBoardDetection({
      score: 0.94,
      x: 760,
      y: 120,
      width: 300,
      height: 300,
      withMask: false,
    });

    const result = locateBoard([lowScoreBoard, highScoreBoard], IMAGE_SIZE);
    const centerX =
      result.corners.reduce((sum, p) => sum + p.x, 0) / result.corners.length;

    expect(result.status).not.toBe("failed");
    expect(centerX).toBeGreaterThan(700);
  });

  it("marks localization as lowConfidence when threshold is higher than score", () => {
    const result = locateBoard(
      [makeBoardDetection({ withMask: false })],
      IMAGE_SIZE,
      { lowConfidenceThreshold: 0.99 },
    );

    expect(result.status).toBe("lowConfidence");
    expect(result.cornerScore).toBeLessThan(0.99);
    expect(result.message).toContain("below threshold");
  });

  it("exposes hinge metadata when hinge detection is present", () => {
    const result = locateBoard(
      [makeBoardDetection(), makeHingeDetection()],
      IMAGE_SIZE,
    );

    expect(result.status).not.toBe("failed");
    expect(result.hingeFound).toBe(true);
    expect(result.hingePolygon).toBeDefined();
    expect(result.hingePolygon).toHaveLength(4);
    expect(result.cornerScore).toBeGreaterThan(0.55);
  });

  it("returns corners ordered TL, TR, BR, BL", () => {
    const result = locateBoard(
      [makeBoardDetection({ withMask: false })],
      IMAGE_SIZE,
    );

    const [tl, tr, br, bl] = result.corners;
    expect(tl.x).toBeLessThan(tr.x);
    expect(tl.y).toBeLessThan(bl.y);
    expect(br.x).toBeGreaterThan(bl.x);
    expect(br.y).toBeGreaterThan(tr.y);
  });
});
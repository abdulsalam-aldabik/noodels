import { describe, expect, it, vi } from "vitest";

import {
  BOARD_CLASS_ID,
  HINGE_CLASS_ID,
  type RawDetection,
} from "../../inference/types";
import type { OrientationMatchResult } from "../OrientationMatcher";
import { mapPiecesToBoardState } from "../PieceMapper";
import type { RectifiedFrame } from "../types";

const IDENTITY_H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

const RECTIFIED_FRAME: RectifiedFrame = {
  canvasSize: { width: 560, height: 560 },
  cellSpacingPx: 40,
  homography: {
    forward: IDENTITY_H,
    inverse: IDENTITY_H,
    condition: 1,
  },
  pinPoints: [],
};

function makeDetection(overrides: Partial<RawDetection>): RawDetection {
  return {
    classId: 0,
    className: "A",
    score: 0.9,
    bbox: { x: 4, y: 5, width: 2, height: 2 },
    ...overrides,
  };
}

function fixedMatchResult(
  overrides: Partial<OrientationMatchResult> = {},
): OrientationMatchResult {
  return {
    orientation: 90,
    mirrored: false,
    confidence: 0.8,
    ambiguous: false,
    topK: [
      {
        orientation: 90,
        mirrored: false,
        score: 0.8,
        orientationIndex: 0,
      },
    ],
    ...overrides,
  };
}

describe("mapPiecesToBoardState", () => {
  it("maps piece detections and ignores board/hinge classes", () => {
    const matcher = vi.fn(() => fixedMatchResult());
    const detections: RawDetection[] = [
      makeDetection({ classId: BOARD_CLASS_ID, className: "board" }),
      makeDetection({ classId: HINGE_CLASS_ID, className: "hinge" }),
      makeDetection({ classId: 0, className: "A" }),
    ];

    const state = mapPiecesToBoardState(detections, RECTIFIED_FRAME, {
      orientationMatcher: matcher,
    });

    expect(matcher).toHaveBeenCalledTimes(1);
    expect(state.placements).toHaveLength(1);
    expect(state.unassignedDetections).toHaveLength(0);
    expect(state.placements[0].className).toBe("A");
    expect(state.placements[0].cell).toEqual({ row: 6, col: 5 });
    expect(state.placements[0].confidence).toBeCloseTo(0.72, 8);
  });

  it("falls back to bbox center when a detection has no mask", () => {
    const matcher = vi.fn(() => fixedMatchResult());
    const detections: RawDetection[] = [
      makeDetection({
        classId: 1,
        className: "B",
        bbox: { x: 4.4, y: 7.6, width: 1, height: 1 },
        mask: undefined,
      }),
    ];

    const state = mapPiecesToBoardState(detections, RECTIFIED_FRAME, {
      orientationMatcher: matcher,
    });

    expect(state.placements).toHaveLength(1);
    expect(state.placements[0].cell).toEqual({ row: 8, col: 5 });
  });

  it("uses mask centroid and forwards observed cells into matcher", () => {
    const matcher = vi.fn((input: { observedCells: Array<{ row: number; col: number }> }) => {
      void input;
      return fixedMatchResult();
    });
    const detections: RawDetection[] = [
      makeDetection({
        classId: 2,
        className: "C",
        bbox: { x: 0, y: 0, width: 14, height: 14 },
        mask: {
          width: 2,
          height: 2,
          data: new Uint8Array([
            0, 1,
            0, 0,
          ]),
        },
      }),
    ];

    const state = mapPiecesToBoardState(detections, RECTIFIED_FRAME, {
      orientationMatcher: matcher,
    });

    expect(state.placements).toHaveLength(1);
    expect(state.placements[0].cell).toEqual({ row: 4, col: 11 });

    const firstCall = matcher.mock.calls[0];
    expect(firstCall).toBeDefined();
    const matcherArg = firstCall[0];
    expect(matcherArg.observedCells).toContainEqual({ row: 4, col: 11 });
  });

  it("marks unknown non-piece detections as unassigned", () => {
    const detections: RawDetection[] = [
      makeDetection({
        classId: 91,
        className: "class_91",
      }),
    ];

    const state = mapPiecesToBoardState(detections, RECTIFIED_FRAME);

    expect(state.placements).toHaveLength(0);
    expect(state.unassignedDetections).toHaveLength(1);
  });

  it("keeps only the highest-confidence detection for duplicate piece keys", () => {
    const matcher = vi.fn(() => fixedMatchResult({ confidence: 1 }));
    const detections: RawDetection[] = [
      makeDetection({ classId: 0, className: "A", score: 0.4, bbox: { x: 2, y: 2, width: 1, height: 1 } }),
      makeDetection({ classId: 0, className: "A", score: 0.9, bbox: { x: 8, y: 9, width: 1, height: 1 } }),
    ];

    const state = mapPiecesToBoardState(detections, RECTIFIED_FRAME, {
      orientationMatcher: matcher,
    });

    expect(state.placements).toHaveLength(1);
    expect(state.unassignedDetections).toHaveLength(1);
    expect(state.placements[0].sourceDetectionIndex).toBe(1);
  });
});

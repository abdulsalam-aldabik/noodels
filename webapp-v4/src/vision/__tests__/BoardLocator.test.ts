import { describe, expect, test } from "vitest";
import { CLASS_BOARD } from "../../inference/inferenceTypes";
import type { RawDetection } from "../../inference/inferenceTypes";
import {
  locateBoard,
  scoreBoardHypotheses,
  type BoardLocateDiagnostics,
} from "../BoardLocator";

function createDiagnostics(): BoardLocateDiagnostics {
  return {
    failureCode: null,
    failureDetail: null,
    cornerSource: null,
    boardConfidence: 0,
    candidatesTried: [],
  };
}

function makeBoardDetection(overrides: Partial<RawDetection> = {}): RawDetection {
  return {
    classId: CLASS_BOARD,
    confidence: 0.9,
    bbox: [10, 10, 110, 110],
    maskPolygon: [
      [10, 10],
      [110, 10],
      [110, 110],
      [10, 110],
    ],
    maskCentroid: [60, 60],
    ...overrides,
  };
}

describe("BoardLocator diagnostics and fallback", () => {
  test("returns board_class_missing when no board class exists", () => {
    const diagnostics = createDiagnostics();

    const result = locateBoard(
      [
        {
          classId: 0,
          confidence: 0.95,
          bbox: [0, 0, 10, 10],
          maskPolygon: [[1, 1]],
          maskCentroid: [1, 1],
        },
      ],
      0,
      0,
      diagnostics,
    );

    expect(result).toBeNull();
    expect(diagnostics.failureCode).toBe("board_class_missing");
  });

  test("returns board_confidence_low when board score is below threshold", () => {
    const diagnostics = createDiagnostics();

    const result = locateBoard(
      [makeBoardDetection({ confidence: 0.1 })],
      0,
      0,
      diagnostics,
    );

    expect(result).toBeNull();
    expect(diagnostics.failureCode).toBe("board_confidence_low");
  });

  test("falls back to bbox corners when mask hull is unusable", () => {
    const diagnostics = createDiagnostics();

    const result = locateBoard(
      [
        makeBoardDetection({
          maskPolygon: [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
        }),
      ],
      0,
      0,
      diagnostics,
    );

    expect(result).not.toBeNull();
    expect(diagnostics.cornerSource).toBe("bbox");
    expect(diagnostics.failureCode).toBeNull();
  });

  test("reports homography_failed when all corner candidates are singular", () => {
    const diagnostics = createDiagnostics();

    const result = locateBoard(
      [
        makeBoardDetection({
          bbox: [10, 10, 10, 110],
          maskPolygon: [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ],
        }),
      ],
      0,
      0,
      diagnostics,
    );

    expect(result).toBeNull();
    expect(diagnostics.failureCode).toBe("homography_failed");
  });

  test("scores four board orientation hypotheses", () => {
    const diagnostics = createDiagnostics();

    const board = locateBoard(
      [
        makeBoardDetection(),
        {
          classId: 0,
          confidence: 0.85,
          bbox: [20, 20, 40, 40],
          maskPolygon: [[22, 22], [38, 22], [38, 38], [22, 38]],
          maskCentroid: [30, 30],
        },
      ],
      0,
      0,
      diagnostics,
    );

    expect(board).not.toBeNull();
    const hypotheses = scoreBoardHypotheses(board!, [
      {
        classId: 0,
        confidence: 0.9,
        bbox: [25, 25, 45, 45],
        maskPolygon: [[27, 27], [43, 27], [43, 43], [27, 43]],
        maskCentroid: [35, 35],
      },
    ]);

    expect(hypotheses.length).toBe(4);
    expect(hypotheses[0].score).toBeGreaterThanOrEqual(hypotheses[1].score);
  });
});

import type { PiecePlacement } from "../engine/types";
import type { NoodlesSolverResult } from "../engine/solver";

/** Which physical edge of the board the hinge sits on. */
export type HingeEdge = "top" | "bottom" | "left" | "right";

/**
 * The board reference frame, established by detecting the board mask (class 11)
 * and optionally the hinge (class 12), then computing the homography H that maps
 * image pixels → board grid coordinates (0–13).
 */
export interface CalibratedBoardRef {
  /** Full board mask polygon in original image pixels. */
  boardPolygon: [number, number][];
  /** Four ordered corner points: [TL, TR, BR, BL] in image pixels.
   *  Ordering is from the board's perspective (hinge = top). */
  boardCorners: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  /** Which physical board edge the hinge is on (used to correct orientation). */
  hingeEdge: HingeEdge;
  /** 0–1; below 0.5 means orientation is uncertain and defaults to 'top'. */
  hingeConfidence: number;
  /**
   * 3×3 homography matrix H in row-major order.
   * Maps image pixel [px, py] → board grid [col, row] via:
   *   [col', row', w'] = H × [px, py, 1]
   *   col = col'/w', row = row'/w'
   * Grid coordinates range 0–13 (matching BOARD_WIDTH-1 / BOARD_HEIGHT-1).
   */
  homographyMatrix: number[][];
  /** 0–1 confidence in the board detection itself. */
  boardConfidence: number;
}

/**
 * A single piece detection after its mask centroid has been projected through
 * the board homography and snapped to the nearest valid board cell.
 */
export interface MappedPiecePlacement {
  /** YOLO class index, 0–10. */
  classId: number;
  /** Piece letter A–K. */
  pieceKey: string;
  /** Raw mask centroid in original image pixels. */
  imageCentroid: [number, number];
  /** Centroid projected into board grid space via H. May be fractional. */
  boardCentroid: [number, number];
  /** [row, col] of the snapped board cell (nearest valid cell). */
  candidateCell: [number, number];
  /**
   * Cell confidence: 1 means centroid lands exactly at cell centre,
   * 0 means it is MAX_CELL_RADIUS board-units away (threshold for rejection).
   */
  cellConfidence: number;
  /** True if a second valid cell is within CELL_AMBIGUITY_RATIO × nearest distance. */
  ambiguous: boolean;
  /** The alternative candidate cells when ambiguous. */
  alternativeCells: [number, number][];
}

/** Report produced after validating the mapped placements. */
export interface ValidationReport {
  valid: boolean;
  /** Pairs of pieces whose mapped cells conflict (overlap). */
  conflicts: Array<{ pieceA: number; pieceB: number; sharedCells: number[] }>;
  /** classIds whose centroid is out of bounds or whose confidence is too low. */
  droppedPieces: number[];
  /** Whether a full solution is reachable from this partial state. null = timed out. */
  solvable: boolean | null;
  warnings: string[];
}

/** Formatted hint to show the user next. */
export interface HintPayload {
  nextPieceId: number;
  nextPieceKey: string;
  placement: PiecePlacement;
  hintConfidence: "high" | "medium" | "low";
  alternativePlacements: number;
  solverTimeMs: number;
  statesExplored: number;
}

/**
 * The full result of one scan pipeline run.
 * Either `error` is set (pipeline aborted) or `hint` / `report` are set.
 */
export type ScanResult =
  | { ok: false; error: string; stage: string }
  | {
      ok: true;
      boardRef: CalibratedBoardRef;
      mappedPlacements: MappedPiecePlacement[];
      report: ValidationReport;
      confirmedPlacements: Map<number, PiecePlacement>;
      hint: HintPayload | null;
      solverResult: NoodlesSolverResult | null;
    };

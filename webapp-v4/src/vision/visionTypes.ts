import type { PiecePlacement } from "../engine/types";
import type { NoodlesSolverResult } from "../engine/solver";
import type { PostprocessDebug } from "../inference/postprocessing";
import type { RawDetection } from "../inference/inferenceTypes";
import type { RectifiedGeometry } from "./RectifiedDetector";

// ── Pipeline config ────────────────────────────────────────────────────────────

/**
 * Tunable parameters for the scan pipeline. Controls board corner inset
 * (how much of the outer frame/hinge to exclude) and the margin around the
 * 14×14 grid in the rectified 640×640 image.
 */
export interface ScanPipelineConfig {
  boardInset: {
    /** Fraction of board height to trim at the top (hinge bar + frame). */
    topRatio: number;
    /** Fraction of board width to trim at the sides. */
    sideRatio: number;
    /** Fraction of board height to trim at the bottom. */
    bottomRatio: number;
  };
  /**
   * Cells of margin around the 14×14 grid in the 640×640 rectified image.
   * Default 1.0 → cellSpacingPx = 640/15 = 42.667.
   */
  marginCells: number;
  /** If true, the ScanResult will include intermediate canvases + detections for debug rendering. */
  returnArtifacts?: boolean;
}

export const DEFAULT_SCAN_CONFIG: ScanPipelineConfig = {
  boardInset: { topRatio: 0.1, sideRatio: 0.03, bottomRatio: 0.03 },
  marginCells: 1,
};

// ── Scan artifacts (debug lab use only) ───────────────────────────────────────

/**
 * Intermediate pipeline data returned when `config.returnArtifacts === true`.
 * Used by the debug lab page to render all 5 diagnostic images without
 * re-running inference.
 */
export interface ScanArtifacts {
  imageSource: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  fullDetections: RawDetection[];
  rectifiedCanvas: OffscreenCanvas;
  rectifiedDetections: RawDetection[];
  rectifiedGeometry: RectifiedGeometry;
  coveredCellsByClass: Map<number, Set<number>>;
}

// ── Board reference ────────────────────────────────────────────────────────────

/**
 * The board reference frame, established by detecting the board mask (class 11)
 * and optionally the hinge (class 12), then computing the homography H that maps
 * image pixels → board grid coordinates (0–13).
 */
export interface CalibratedBoardRef {
  boardPolygon: [number, number][];
  boardCorners: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  homographyMatrix: number[][];
  boardConfidence: number;
  /** Source that produced the board corners (e.g. "mask_diagonal_extremes", "bbox"). */
  boardCornerSource: string;
  /** True if TL/TR corners were snapped to the bottom of the detected hinge bbox. */
  hingeSnapped: boolean;
  /** True if any corner was clamped to image bounds (was out of frame). */
  cornersClipped: boolean;
}

// ── Piece mappings ─────────────────────────────────────────────────────────────

/**
 * A single piece detection after its mask centroid has been projected through
 * the board homography and snapped to the nearest valid board cell.
 */
export interface MappedPiecePlacement {
  classId: number;
  pieceKey: string;
  detectionConfidence: number;
  imageCentroid: [number, number];
  /** Centroid in board-grid space (col, row) — floating point before cell snap. */
  boardCentroid: [number, number];
  boardMaskPoints: [number, number][];
  candidateCell: [number, number];
  cellConfidence: number;
  ambiguous: boolean;
  alternativeCells: [number, number][];
  /** Centroid in rectified 640×640 image space, for debug. */
  centroidRectifiedPx?: [number, number];
}

/** One candidate placement for a piece (from top-K mapping). */
export interface PieceCandidate {
  classId: number;
  pieceKey: string;
  cell: [number, number];
  score: number;
  centroidDist: number;
  detectionConfidence: number;
  shapeFitScore: number;
}

// ── Validation ─────────────────────────────────────────────────────────────────

/** Report produced after validating the mapped placements. */
export interface ValidationReport {
  valid: boolean;
  conflicts: Array<{ pieceA: number; pieceB: number; sharedCells: number[] }>;
  droppedPieces: number[];
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

// ── Debug snapshot ─────────────────────────────────────────────────────────────

/** Full debug snapshot for one scan. */
export interface ScanDebug {
  timestamp: string;
  sourceType: "camera" | "upload";
  timings: {
    preprocess: number;
    inference: number;
    boardLocate: number;
    rectify: number;
    rectifiedInference: number;
    directMap: number;
    assignment: number;
    validate: number;
    hint: number;
    total: number;
  };
  postprocess: PostprocessDebug | null;
  boardDetected: boolean;
  boardConfidence: number;
  boardCornerSource: string | null;
  hingeSnapped: boolean;
  cornersClipped: boolean;
  /** Cell spacing in pixels used for direct rectified-space mapping (should be ~42.667). */
  cellSpacingPx: number;
  allDetections: Array<{
    classId: number;
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
    centroid: [number, number];
  }>;
  rectifiedDetectionsCount: number;
  pieceMappings: Array<{
    classId: number;
    pieceKey: string;
    confidence: number;
    cellConfidence: number;
    candidateCell: [number, number];
    /** Floating-point board (col, row) before cell snap — useful for diagnosis. */
    boardCentroid?: [number, number];
    ambiguous: boolean;
    dropped: boolean;
    centroidRectifiedPx?: [number, number];
  }>;
  confirmedPlacements: Array<{
    classId: number;
    pieceKey: string;
    orientationIndex: number;
    positions: number[];
  }>;
  droppedPieces: number[];
  warnings: string[];
  artifactPaths: Record<string, string>;
  error: string | null;
  errorStage: string | null;
}

// ── Scan result ────────────────────────────────────────────────────────────────

/**
 * The full result of one scan pipeline run.
 */
export type ScanResult =
  | { ok: false; error: string; stage: string; debug: ScanDebug }
  | {
      ok: true;
      boardRef: CalibratedBoardRef;
      mappedPlacements: MappedPiecePlacement[];
      report: ValidationReport;
      confirmedPlacements: Map<number, PiecePlacement>;
      hint: HintPayload | null;
      solverResult: NoodlesSolverResult | null;
      debug: ScanDebug;
      /** Populated only when config.returnArtifacts === true. */
      _artifacts?: ScanArtifacts;
    };

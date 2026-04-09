import type { PiecePlacement } from "../engine/types";
import type { NoodlesSolverResult } from "../engine/solver";
import type { PostprocessDebug } from "../inference/postprocessing";

export type { PostprocessDebug } from "../inference/postprocessing";

/** Which physical edge of the board the hinge sits on. */
export type HingeEdge = "top" | "bottom" | "left" | "right";

export interface CalibratedBoardRef {
  boardPolygon: [number, number][];
  boardCorners: [[number, number], [number, number], [number, number], [number, number]];
  hingeEdge: HingeEdge;
  hingeConfidence: number;
  homographyMatrix: number[][];
  boardConfidence: number;
}

export interface MappedPiecePlacement {
  modelClassId: number;
  classId: number;
  pieceKey: string;
  detectionConfidence: number;
  imageCentroid: [number, number];
  boardCentroid: [number, number];
  boardMaskPoints: [number, number][];
  candidateCell: [number, number];
  cellConfidence: number;
  ambiguous: boolean;
  alternativeCells: [number, number][];
}

export interface ValidationReport {
  valid: boolean;
  conflicts: Array<{ pieceA: number; pieceB: number; sharedCells: number[] }>;
  droppedPieces: number[];
  solvable: boolean | null;
  warnings: string[];
}

export interface HintPayload {
  nextPieceId: number;
  nextPieceKey: string;
  placement: PiecePlacement;
  hintConfidence: "high" | "medium" | "low";
  alternativePlacements: number;
  solverTimeMs: number;
  statesExplored: number;
}

/** Full debug information from one scan — shown in the debug panel. */
export interface ScanDebug {
  /** How long each stage took in ms. */
  timings: {
    preprocess: number;
    inference: number;
    boardLocate: number;
    pieceMap: number;
    validate: number;
    hint: number;
    total: number;
  };
  /** Output from YOLO postprocessing — tensor shapes, class scores, counts. */
  postprocess: PostprocessDebug | null;
  /** Board detection outcome. */
  boardDetected: boolean;
  boardConfidence: number;
  /** Board localization diagnostics from BoardLocator fallback chain. */
  boardFailureCode: string | null;
  boardFailureDetail: string | null;
  boardCornerSource: string | null;
  boardCornerCandidates: string[];
  /** Whether OpenCV fallback was actually ready during this scan. */
  openCvReady: boolean;
  /** Whether OpenCV found a usable 4-corner board contour on the full frame. */
  cvContourDetected: boolean;
  /** OpenCV contour corners in image pixel space when available. */
  cvContourCorners: [number, number][];
  hingeDetected: boolean;
  hingeEdge: HingeEdge | null;
  /** Class name labels for the 13 YOLO classes (A-K = 0-10, board=11, hinge=12). */
  classLabels: string[];
  /** Every detection after NMS (all classes). */
  allDetections: Array<{
    classId: number;
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
    centroid: [number, number];
  }>;
  /** Piece mappings with their grid cell and confidence. */
  pieceMappings: Array<{
    modelClassId: number;
    classId: number;
    pieceKey: string;
    confidence: number;
    cellConfidence: number;
    candidateCell: [number, number];
    ambiguous: boolean;
    dropped: boolean;
  }>;
  /** Scores for each tested board orientation hypothesis. */
  orientationHypotheses: Array<{
    rotationDeg: 0 | 90 | 180 | 270;
    score: number;
    landingCount: number;
    collisionCount: number;
    meanLandingConfidence: number;
  }>;
  /** Rotation selected by the hypothesis scorer (0,1,2,3 quarter-turns). */
  selectedOrientation: number;
  /** Whether a rectified second inference pass was used for piece mapping. */
  rectifiedSecondPassUsed: boolean;
  rectifiedDetectionsCount: number;
  confirmedPlacements: Array<{
    classId: number;
    pieceKey: string;
    orientationIndex: number;
    positions: number[];
    rotationSteps?: number;
    mirrored?: boolean;
  }>;
  /** Any error that occurred. */
  error: string | null;
  errorStage: string | null;
}

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
    };

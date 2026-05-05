import type { Point2D, ImageSize, RawDetection } from "../inference/types";

export type CornerSource =
  | "hull_diagonal_extremes"
  | "bbox_fused"
  | "ransac_line_intersection"
  | "hinge_anchored"
  | "fallback_bbox";

export interface CornerCandidate {
  source: CornerSource;
  corners: [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL (image px)
  score: number;
  subScores: {
    rectangularity: number;
    aspect: number;
    edgeContrast: number;
    hingeAlignment: number;
  };
}

export type LocalizationStatus = "ok" | "lowConfidence" | "failed";

export interface BoardRef {
  imageSize: ImageSize;
  corners: [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL
  cornerSource: CornerSource;
  cornerScore: number;
  candidates: CornerCandidate[];
  hingeFound: boolean;
  hingePolygon?: Point2D[];
  status: LocalizationStatus;
  message?: string;
}

export interface Homography {
  forward: number[]; // 3x3 row-major, image -> board
  inverse: number[]; // 3x3 row-major, board -> image
  condition: number;
}

export interface RectifiedFrame {
  canvasSize: ImageSize;
  cellSpacingPx: number;
  homography: Homography;
  pinPoints: Point2D[]; // board-space coords of the 21 pins
}

export type PieceOrientation = 0 | 90 | 180 | 270;

export type PieceMapSource = "yolo-mask" | "color-rescue";

export interface PiecePlacement {
  classId: number;
  className: string;
  cell: { row: number; col: number };
  orientation: PieceOrientation;
  mirrored: boolean;
  confidence: number;
  ambiguous: boolean;
  /** Where this placement came from. Mask = YOLO segmentation. Color = fallback. */
  source?: PieceMapSource;
  /** Mean YOLO mask coverage across the placement's cells. Only set when source = "yolo-mask". */
  maskCellCoverage?: number;
  canonicalPositions?: number[];
  canonicalOrientationIndex?: number;
  /** NEW (Task 5): true when placed despite being ambiguous (lenient/off policy). */
  placedDespiteAmbiguity?: boolean;
}

export interface PieceMapStats {
  /** Number of placements produced from YOLO segmentation masks. */
  maskCount: number;
  /** Number of placements produced from color fallback. */
  colorRescueCount: number;
  /** Color-only classes that were dropped because they conflicted with mask placements. */
  droppedColorClassIds: number[];
  /** NEW (Task 4A): how many duplicate color-rescue class assignments were dropped. */
  droppedDuplicateCount: number;
}

export interface UnassignedPiece {
  classId: number;
  className: string;
  reason: "ambiguous" | "duplicate" | "low_confidence";
}

export interface BoardState {
  placements: PiecePlacement[];
  unassignedDetections: RawDetection[];
  /** NEW (Task 5): pieces that were detected but not placed, with reasons. */
  unassignedPieces: UnassignedPiece[];
  stats: PieceMapStats;
}

/** One class-13 detection reduced to its centroid, in image pixels. */
export interface PinDetection {
  /** Mask centroid in source-image pixel coordinates. */
  center: Point2D;
  /** Confidence from the YOLO detection head. */
  score: number;
  /** Radius estimate (sqrt(area / π)), in image pixels. Used for distance thresholds. */
  radiusPx: number;
  /** Index of the originating RawDetection in the inference result. */
  sourceDetectionIndex: number;
}

/** A detected pin assigned to a canonical pin index. */
export interface PinCorrespondence {
  /** 0..20, index into POSITIONS_AROUND_PINS / computePinBoardPoints. */
  canonicalPinIndex: number;
  /** Detected pin center in image pixels. */
  imagePoint: Point2D;
  /** Canonical pin center in board-space (cell units). */
  boardPoint: Point2D;
  /** Detection score (forwarded from PinDetection). */
  score: number;
  /** Residual after final homography fit, in board-space units (cells). */
  residualBoardUnits: number;
}

export type PinLocalizationStatus =
  | "ok"
  | "lowPinCount"
  | "fallback_corners"
  | "failed";

export interface BoardRefPins extends BoardRef {
  pinDetections: PinDetection[];
  pinCorrespondences: PinCorrespondence[];
  /** N-point homography solved from matched pins (image → board), row-major 3×3. */
  pinHomography?: Homography;
  pinStatus: PinLocalizationStatus;
  pinMessage?: string;
}


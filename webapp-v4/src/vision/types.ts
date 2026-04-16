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

export interface PiecePlacement {
  classId: number;
  className: string;
  cell: { row: number; col: number };
  orientation: PieceOrientation;
  mirrored: boolean;
  confidence: number;
  ambiguous: boolean;
  topK: Array<{
    orientation: PieceOrientation;
    mirrored: boolean;
    score: number;
  }>;
  sourceDetectionIndex: number;
}

export interface BoardState {
  placements: PiecePlacement[];
  unassignedDetections: RawDetection[];
}

export const SegmentShape = {
  CURVE: 0,
  CROSS_NS: 1,
  CROSS_EW: 2,
} as const;

export type SegmentShape = (typeof SegmentShape)[keyof typeof SegmentShape];

export interface PieceDefinition {
  id: number;
  bigGridPositions: number[];
  shapes: SegmentShape[];
}

export interface PieceOrientation {
  positions: number[];
  shapes: SegmentShape[];
}

export interface PiecePlacement {
  pieceId: number;
  orientationIndex: number;
  positions: number[];
  shapes: SegmentShape[];
}

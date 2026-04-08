export interface BoardPieceTuning {
  baseRotationSteps: 0 | 1 | 2 | 3;
  baseMirrored: boolean;
  invertRotationWhenMirrored?: boolean;
  swapEvenStepsWhenMirrored?: boolean;
  /** Small uniform scale correction after the deterministic pipeline. Default 1. */
  residualScale?: number;
  /**
   * Per-orientationIndex world-space offset corrections (cell units).
   * Key = placement.orientationIndex. Falls back to residualOffsetX/Y if key absent.
   */
  orientationOffsets?: Record<number, { x: number; y: number }>;
  /** Fallback X offset (cell units) for orientations not in orientationOffsets. Default 0. */
  residualOffsetX?: number;
  /** Fallback Y offset (cell units) for orientations not in orientationOffsets. Default 0. */
  residualOffsetY?: number;
}

const DEFAULT_BOARD_TUNING: BoardPieceTuning = {
  baseRotationSteps: 0,
  baseMirrored: false,
  invertRotationWhenMirrored: false,
  swapEvenStepsWhenMirrored: false,
};

// baseMirrored: true when the OBJ model's natural orientation corresponds to the
// engine's mirrored base state, so a scale(-1) is needed to display the non-mirrored piece.
//
// baseRotationSteps: offset (in 90° steps) applied to align the model's natural
// orientation with the engine's base orientation (rotationSteps=0, mirrored=false).
export const BOARD_PIECE_TUNING_BY_ID: Record<number, BoardPieceTuning> = {
  0:  { baseRotationSteps: 1, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0.1, y: -0.4 } } },
  1:  { baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, orientationOffsets: { 0: { x:  0,   y: -0.3 } } },
  2:  { baseRotationSteps: 3, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0.5, y:  0   } } },
  3:  { baseRotationSteps: 1, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0.5, y:  0   } } },
  4:  { baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, orientationOffsets: { 0: { x:  0.6, y: -0.6 } } },
  5:  { baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true, orientationOffsets: { 0: { x: -0.1, y:  0.5 } } },
  6:  { baseRotationSteps: 1, baseMirrored: false, invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0,   y:  0   } } },
  7:  { baseRotationSteps: 0, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x: -0.9, y: -0.5 } } },
  8:  { baseRotationSteps: 3, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0.1, y:  0   } } },
  9:  { baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true, orientationOffsets: { 0: { x: -0.1, y: -0.5 } } },
  10: { baseRotationSteps: 2, baseMirrored: true,  invertRotationWhenMirrored: true,  orientationOffsets: { 0: { x:  0,   y:  0.4 } } },
};

export function getBoardPieceTuning(pieceId: number): BoardPieceTuning {
  return BOARD_PIECE_TUNING_BY_ID[pieceId] ?? DEFAULT_BOARD_TUNING;
}

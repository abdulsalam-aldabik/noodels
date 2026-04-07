export interface BoardPieceTuning {
  baseRotationSteps: 0 | 1 | 2 | 3;
  baseMirrored: boolean;
  boardScale: number;
  invertRotationWhenMirrored?: boolean;
  swapEvenStepsWhenMirrored?: boolean;
}

const DEFAULT_BOARD_TUNING: BoardPieceTuning = {
  baseRotationSteps: 0,
  baseMirrored: false,
  boardScale: 1,
  invertRotationWhenMirrored: false,
  swapEvenStepsWhenMirrored: false,
};

// baseMirrored: true when the OBJ model's natural orientation corresponds to the
// engine's mirrored base state, so a scale(-1) is needed to display the non-mirrored piece.
//
// baseRotationSteps: offset (in 90° steps) applied to align the model's natural
// orientation with the engine's base orientation (rotationSteps=0, mirrored=false).
export const BOARD_PIECE_TUNING_BY_ID: Record<number, BoardPieceTuning> = {
  0:  { baseRotationSteps: 1, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
  1:  { baseRotationSteps: 0, baseMirrored: false,  boardScale: 1, invertRotationWhenMirrored: false },
  2:  { baseRotationSteps: 3, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
  3:  { baseRotationSteps: 1, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
  4:  { baseRotationSteps: 0, baseMirrored: false,  boardScale: 1, invertRotationWhenMirrored: false },
  5:  { baseRotationSteps: 0, baseMirrored: false, boardScale: 1, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true },
  6:  { baseRotationSteps: 1, baseMirrored: false, boardScale: 1, invertRotationWhenMirrored: true },
  7:  { baseRotationSteps: 0, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
  8:  { baseRotationSteps: 3, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
  9:  { baseRotationSteps: 0, baseMirrored: false, boardScale: 1, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true },
  10: { baseRotationSteps: 2, baseMirrored: true,  boardScale: 1, invertRotationWhenMirrored: true },
};

export function getBoardPieceTuning(pieceId: number): BoardPieceTuning {
  return BOARD_PIECE_TUNING_BY_ID[pieceId] ?? DEFAULT_BOARD_TUNING;
}

export interface BoardPieceTuning {
  baseRotationSteps: 0 | 1 | 2 | 3;
  baseMirrored: boolean;
  invertRotationWhenMirrored?: boolean;
  swapEvenStepsWhenMirrored?: boolean;
  residualScale?: number;
  /** World-space offset per orientationIndex. Key = placement.orientationIndex. */
  orientationOffsets?: Record<number, { x: number; y: number }>;
}

const DEFAULT_BOARD_TUNING: BoardPieceTuning = {
  baseRotationSteps: 0,
  baseMirrored: false,
};

export const BOARD_PIECE_TUNING_BY_ID: Record<number, BoardPieceTuning> = {
  // Piece J (0) — 8 orientations
  0: {
    baseRotationSteps: 1, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.1, y:  0.1 },
      1: { x:  0.4, y: -0.4 },
      2: { x:  0.9, y:  0   },
      3: { x:  0.5, y:  0.4 },
      4: { x:  0.1, y: -0.1 },
      5: { x:  0.5, y: -0.4 },
      6: { x:  0.9, y:  0.1 },
      7: { x:  0.4, y:  0.4 },
    },
  },
  // Piece C (1) — 4 orientations
  1: {
    baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false,
    orientationOffsets: {
      0: { x:  0.5, y: -0.3 },
      1: { x:  0.8, y:  0   },
      2: { x:  0.5, y:  0.2 },
      3: { x:  0.2, y:  0   },
    },
  },
  // Piece H (2) — 8 orientations
  2: {
    baseRotationSteps: 3, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.5, y:  0.5 },
      1: { x: -0.1, y:  0   },
      2: { x:  0.5, y: -0.5 },
      3: { x:  1,   y:  0   },
      4: { x:  0.4, y: -0.5 },
      5: { x:  1,   y:  0   },
      6: { x:  0.4, y:  0.5 },
      7: { x:  0,   y:  0   },
    },
  },
  // Piece B (3) — 8 orientations
  3: {
    baseRotationSteps: 1, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.5, y:  0.5 },
      1: { x:  0,   y:  0   },
      2: { x:  0.5, y: -0.5 },
      3: { x:  1,   y:  0   },
      4: { x:  0.4, y: -0.5 },
      5: { x:  1,   y:  0   },
      6: { x:  0.5, y:  0.5 },
      7: { x:  0,   y:  0   },
    },
  },
  // Piece A (4) — 4 orientations
  4: {
    baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false,
    orientationOffsets: {
      0: { x:  1.1, y: -0.6 },
      1: { x:  1.1, y:  0.6 },
      2: { x: -0.2, y:  0.6 },
      3: { x: -0.1, y: -0.6 },
    },
  },
  // Piece K (5) — 8 orientations
  5: {
    baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.4, y:  0.5 },
      1: { x: -0.1, y: -0.1 },
      2: { x:  0.5, y: -0.5 },
      3: { x:  1,   y:  0.1 },
      4: { x:  0.4, y: -0.5 },
      5: { x:  1,   y: -0.1 },
      6: { x:  0.5, y:  0.5 },
      7: { x: -0.1, y:  0.1 },
    },
  },
  // Piece I (6) — 4 orientations
  6: {
    baseRotationSteps: 1, baseMirrored: false, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.5, y:  0 },
      1: { x:  0.5, y:  0 },
      2: { x:  0.5, y:  0 },
      3: { x:  0.5, y:  0 },
    },
  },
  // Piece G (7) — 4 orientations
  7: {
    baseRotationSteps: 0, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  1.4, y: -0.5 },
      1: { x:  1,   y:  0.9 },
      2: { x: -0.5, y:  0.5 },
      3: { x:  0,   y: -1   },
    },
  },
  // Piece D (8) — 8 orientations
  8: {
    baseRotationSteps: 3, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.5, y: -0.1 },
      1: { x:  0.6, y:  0   },
      2: { x:  0.4, y:  0.1 },
      3: { x:  0.4, y:  0   },
      4: { x:  0.5, y:  0.1 },
      5: { x:  0.4, y:  0   },
      6: { x:  0.5, y: -0.1 },
      7: { x:  0.6, y:  0   },
    },
  },
  // Piece F (9) — 8 orientations
  9: {
    baseRotationSteps: 0, baseMirrored: false, invertRotationWhenMirrored: false, swapEvenStepsWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.4, y: -0.5 },
      1: { x:  1,   y: -0.1 },
      2: { x:  0.6, y:  0.5 },
      3: { x:  0,   y:  0.1 },
      4: { x:  0.4, y:  0.5 },
      5: { x:  0,   y: -0.1 },
      6: { x:  0.6, y: -0.5 },
      7: { x:  1,   y:  0.1 },
    },
  },
  // Piece E (10) — 4 orientations
  10: {
    baseRotationSteps: 2, baseMirrored: true, invertRotationWhenMirrored: true,
    orientationOffsets: {
      0: { x:  0.5, y: -0.3 },
      1: { x:  0.8, y:  0   },
      2: { x:  0.5, y:  0.3 },
      3: { x:  0.2, y:  0   },
    },
  },
};

export function getBoardPieceTuning(pieceId: number): BoardPieceTuning {
  return BOARD_PIECE_TUNING_BY_ID[pieceId] ?? DEFAULT_BOARD_TUNING;
}

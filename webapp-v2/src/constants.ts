/**
 * IQ Noodles piece definitions and model configuration.
 * Colors and labels sourced from the training notebooks.
 */

export const MODEL_PATH = '/models/best.onnx';
export const MODEL_INPUT_SIZE = 640;
export const CONFIDENCE_THRESHOLD = 0.3;
export const IOU_THRESHOLD = 0.5;
export const NUM_CLASSES = 11;

/** Piece labels A–K mapping to class indices 0–10 */
export const PIECE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;

/** Piece color definitions matching the Blender synthetic data generator */
export const PIECE_COLORS: Record<string, { name: string; rgb: [number, number, number] }> = {
  A: { name: 'Yellow',       rgb: [0xF9, 0xD6, 0x5E] },
  B: { name: 'SkyBlue',      rgb: [0x08, 0xA7, 0xE8] },
  C: { name: 'DarkBlue',     rgb: [0x20, 0x6D, 0xD9] },
  D: { name: 'Green',        rgb: [0x1F, 0xA1, 0x5B] },
  E: { name: 'Red',          rgb: [0xEE, 0x39, 0x4F] },
  F: { name: 'Teal',         rgb: [0x85, 0xDA, 0xBB] },
  G: { name: 'Pink',         rgb: [0xEC, 0x71, 0xA8] },
  H: { name: 'Purple',       rgb: [0xC7, 0x78, 0xB9] },
  I: { name: 'Orange',       rgb: [0xFC, 0x69, 0x0C] },
  J: { name: 'DarkRed',      rgb: [0xB6, 0x30, 0x48] },
  K: { name: 'YellowGreen',  rgb: [0x95, 0xD4, 0x50] },
};

/** Class names as they appear in the YOLO model data.yaml (matching training order) */
export const CLASS_NAMES = [
  'A_Yellow',       // 0
  'B_SkyBlue',      // 1
  'C_DarkBlue',     // 2
  'D_Green',        // 3
  'E_Red',          // 4
  'F_Teal',         // 5
  'G_Pink',         // 6
  'H_Purple',       // 7
  'I_Orange',       // 8
  'J_DarkRed',      // 9
  'K_YellowGreen',  // 10
] as const;

/**
 * Maps YOLO class ID (0–10, A–K) → Java solver piece index (0–10).
 *
 * The Blender training script assigns class IDs by color (A=Yellow, B=SkyBlue, …).
 * The Java solver (PiecesNoodles.java) assigns piece indices by shape, with its
 * own independent color ordering (0=DarkRed, 1=DarkBlue, 2=Purple, …).
 *
 * This table bridges the two: when YOLO detects class 0 (Yellow), we must use
 * Java piece 4 (whose shape is the Yellow noodle) for the solver.
 *
 * Derived by matching Blender colors ↔ Java colors:
 *   A(Yellow)→4, B(SkyBlue)→3, C(DarkBlue)→1, D(Green)→8, E(Red)→10,
 *   F(Teal)→9, G(Pink)→7, H(Purple)→2, I(Orange)→6, J(DarkRed)→0, K(YellowGreen)→5
 */
export const YOLO_TO_SOLVER_INDEX: readonly number[] = [
  4,   // A (Yellow)      → Java 4  (Yellow)
  3,   // B (SkyBlue)     → Java 3  (SkyBlue)
  1,   // C (DarkBlue)    → Java 1  (DarkBlue)
  8,   // D (Green)       → Java 8  (DarkGreen)
  10,  // E (Red)         → Java 10 (Red)
  9,   // F (Teal)        → Java 9  (LightGray — 5-pin piece)
  7,   // G (Pink)        → Java 7  (Pink)
  2,   // H (Purple)      → Java 2  (Purple)
  6,   // I (Orange)      → Java 6  (Orange)
  0,   // J (DarkRed)     → Java 0  (DarkRed)
  5,   // K (YellowGreen) → Java 5  (YellowGreen)
];

/**
 * Reverse mapping: Java solver piece index → YOLO class ID.
 * Used to look up the correct Blender/YOLO color for a given solver piece.
 */
export const SOLVER_TO_YOLO_INDEX: readonly number[] = (() => {
  const rev = new Array(YOLO_TO_SOLVER_INDEX.length);
  YOLO_TO_SOLVER_INDEX.forEach((solverIdx, yoloIdx) => {
    rev[solverIdx] = yoloIdx;
  });
  return rev;
})();

export const MODEL_PATH = '/models/best.onnx';
export const MODEL_INPUT_SIZE = 640;
export const CONFIDENCE_THRESHOLD = 0.3;
export const IOU_THRESHOLD = 0.5;

export const NUM_CLASSES = 13;
export const PIECE_CLASS_COUNT = 11;
export const BOARD_CLASS_ID = 11;
export const HINGE_CLASS_ID = 12;

/** Piece labels A-K mapping to class indices 0-10 */
export const PIECE_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;

/** All class names (pieces + board + hinge) */
export const CLASS_NAMES = [
  'A_Yellow', 'B_SkyBlue', 'C_DarkBlue', 'D_Green', 'E_Red',
  'F_Teal', 'G_Pink', 'H_Purple', 'I_Orange', 'J_DarkRed',
  'K_YellowGreen', 'board', 'hinge',
] as const;

/** Piece color definitions */
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

/** Get RGB for any class (pieces use PIECE_COLORS, board/hinge get neutral colors) */
export function getClassRgb(classId: number): [number, number, number] {
  if (classId < PIECE_CLASS_COUNT) {
    const label = PIECE_LABELS[classId];
    return PIECE_COLORS[label].rgb;
  }
  if (classId === BOARD_CLASS_ID) return [100, 100, 100];
  if (classId === HINGE_CLASS_ID) return [200, 200, 200];
  return [128, 128, 128];
}

/** Get label string for any class */
export function getClassLabel(classId: number): string {
  if (classId < PIECE_CLASS_COUNT) return PIECE_LABELS[classId];
  if (classId === BOARD_CLASS_ID) return 'board';
  if (classId === HINGE_CLASS_ID) return 'hinge';
  return `unknown_${classId}`;
}

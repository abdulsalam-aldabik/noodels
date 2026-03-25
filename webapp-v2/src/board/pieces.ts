/**
 * IQ Noodles Pieces — Shape and Position Data
 *
 * Ported from PiecesNoodles.java
 *
 * Each piece's path through the grid consists of segments.
 * Each segment occupies a 2×2 block around a pin.
 * The segment type (CURVE, CROSS_NS, CROSS_EW) defines
 * how the noodle path passes through that pin.
 *
 * Shapes:
 *   CURVE    (0) — path turns at this pin (90° bend)
 *   CROSS_NS (1) — path goes straight North-South through pin
 *   CROSS_EW (2) — path goes straight East-West through pin
 */

export const CURVE = 0;
export const CROSS_NS = 1;
export const CROSS_EW = 2;

export type SegmentType = typeof CURVE | typeof CROSS_NS | typeof CROSS_EW;

export const NUM_PIECES = 11;

/**
 * Initial grid positions for each piece (on the 40×40 BigGrid).
 * These define the piece shape in one canonical orientation.
 *
 * From PiecesNoodles.java: positions[][]
 * Piece indices 0-10 correspond to labels A-K.
 */
export const PIECE_INITIAL_POSITIONS: readonly (readonly number[])[] = [
  [4, 44, 82, 83, 122, 123],               // A: 6 cells
  [44, 45, 48, 49, 86, 87],                 // B: 6 cells
  [9, 49, 90, 130, 168, 169],               // C: 6 cells
  [91, 131, 172, 173, 212, 213, 250, 251],  // D: 8 cells
  [126, 127, 164, 165, 204, 205, 243, 283], // E: 8 cells
  [160, 161, 200, 201, 242, 282, 320, 321], // F: 8 cells
  [208, 209, 246, 247, 286, 287, 324, 325], // G: 8 cells
  [290, 291, 332, 333, 372, 373, 410, 411], // H: 8 cells
  [328, 329, 364, 365, 368, 369, 406, 407], // I: 8 cells
  [360, 361, 402, 403, 442, 443, 484, 485, 524, 525], // J: 10 cells
  [446, 447, 450, 451, 488, 489, 528, 529], // K: 8 cells
];

/**
 * Shape (segment type) for each position of each piece.
 * shape[pieceIdx][posIdx] = CURVE | CROSS_NS | CROSS_EW
 *
 * From PiecesNoodles.java: shape[][]
 */
export const PIECE_SHAPES: readonly (readonly SegmentType[])[] = [
  [CURVE, CROSS_EW, CURVE, CROSS_EW, CURVE, CURVE],                           // A
  [CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW],                     // B
  [CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW],                     // C
  [CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW],       // D
  [CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CROSS_EW, CURVE],       // E
  [CURVE, CURVE, CURVE, CROSS_NS, CROSS_NS, CROSS_EW, CURVE, CROSS_EW],       // F
  [CROSS_EW, CURVE, CURVE, CROSS_EW, CROSS_EW, CURVE, CURVE, CROSS_EW],       // G
  [CURVE, CROSS_NS, CROSS_NS, CURVE, CROSS_EW, CURVE, CURVE, CROSS_EW],       // H
  [CURVE, CURVE, CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW],       // I
  [CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CROSS_NS, CROSS_NS, CURVE, CURVE, CURVE], // J
  [CURVE, CROSS_NS, CROSS_EW, CURVE, CROSS_NS, CROSS_EW, CURVE, CURVE],       // K
];

/**
 * Number of grid cells each piece occupies (always even — each segment = 2 cells).
 */
export const PIECE_LENGTHS: readonly number[] = PIECE_INITIAL_POSITIONS.map(p => p.length);

/**
 * Number of segments (pins) each piece passes through.
 * This equals PIECE_LENGTHS[i] / 2 since each segment uses a 2×2 block.
 */
export const PIECE_SEGMENT_COUNTS: readonly number[] = PIECE_SHAPES.map(s => s.length);

/**
 * Java colors from PiecesNoodles.java (for reference/cross-check with constants.ts):
 * A: (150,20,0)     — DarkRed
 * B: (20,100,180)    — DarkBlue
 * C: (100,30,180)    — Purple
 * D: (70,160,240)    — SkyBlue
 * E: (230,230,0)     — Yellow
 * F: (100,170,0)     — YellowGreen
 * G: (250,150,0)     — Orange
 * H: (250,150,200)   — Pink
 * I: (0,100,0)       — DarkGreen
 * J: (200,200,230)   — LightGray
 * K: (220,30,30)     — Red
 */

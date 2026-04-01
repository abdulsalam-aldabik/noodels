/**
 * IQ Noodles Pieces — 11 piece definitions.
 * Ported from PiecesNoodles.java.
 */

import { CURVE, CROSS_NS, CROSS_EW, type SegmentType } from '../types';

export { CURVE, CROSS_NS, CROSS_EW };
export type { SegmentType };

export const NUM_PIECES = 11;

/** Initial positions on the 40x40 BigGrid (canonical orientation) */
export const PIECE_INITIAL_POSITIONS: readonly (readonly number[])[] = [
  [4, 44, 82, 83, 122, 123],               // A
  [44, 45, 48, 49, 86, 87],                 // B
  [9, 49, 90, 130, 168, 169],               // C
  [91, 131, 172, 173, 212, 213, 250, 251],  // D
  [126, 127, 164, 165, 204, 205, 243, 283], // E
  [160, 161, 200, 201, 242, 282, 320, 321], // F
  [208, 209, 246, 247, 286, 287, 324, 325], // G
  [290, 291, 332, 333, 372, 373, 410, 411], // H
  [328, 329, 364, 365, 368, 369, 406, 407], // I
  [360, 361, 402, 403, 442, 443, 484, 485, 524, 525], // J
  [446, 447, 450, 451, 488, 489, 528, 529], // K
];

/** Segment types per piece position */
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

export const PIECE_SEGMENT_COUNTS: readonly number[] = PIECE_SHAPES.map(s => s.length);

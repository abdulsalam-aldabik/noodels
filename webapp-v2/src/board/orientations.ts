/**
 * Piece Orientation Generator
 *
 * Ported from BigGridNoodles.java
 *
 * The "BigGrid" is a 40×40 virtual grid used for computing rotations
 * and reflections of piece shapes. Pieces are defined using positions
 * on this big grid, and we generate all unique orientations (up to 8)
 * by applying 3 rotations + 1 reflection (+ 3 rotations of the reflection).
 *
 * Key insight: Each grid position encodes (col, row) via index = row*40 + col.
 * Rotation is done by decomposing positions into (col_offset, row_offset)
 * "keys" and applying rotation matrices.
 */

import {
  CURVE, CROSS_NS, CROSS_EW,
  PIECE_INITIAL_POSITIONS,
  PIECE_SHAPES,
  NUM_PIECES,
  type SegmentType,
} from './pieces';

const BIG_GRID_WIDTH = 40;
const BIG_GRID_HEIGHT = 40;

/** Rotation matrices (applied to [col_key, row_key] pairs) */
const ROTATIONS: readonly [number, number][] = [
  [-BIG_GRID_WIDTH, 1],      // 90° CW
  [-1, -BIG_GRID_WIDTH],     // 180°
  [BIG_GRID_WIDTH, -1],      // 270° CW
];

/** Shape transforms under rotation */
const ROTATION_SHAPE: readonly (readonly SegmentType[])[] = [
  [CURVE, CROSS_EW, CROSS_NS],  // CURVE stays, NS↔EW
  [CURVE, CROSS_NS, CROSS_EW],  // 180° — same as original
  [CURVE, CROSS_EW, CROSS_NS],  // 270° — same as 90°
];

/** Vertical reflection */
const REFLECTION: readonly number[] = [1, -BIG_GRID_WIDTH];
const REFLECTION_SHAPE: readonly SegmentType[] = [CURVE, CROSS_EW, CROSS_NS];

export interface PieceOrientation {
  /** Grid positions this piece occupies (on the 14×14 grid, normalized to top-left) */
  positions: number[];
  /** Shape type for each position */
  shapes: SegmentType[];
}

/**
 * Decompose a big-grid position offset into (col_key, row_key).
 */
function getKeys(offset: number): [number, number] {
  const d = Math.floor((Math.abs(offset) + 10) / BIG_GRID_WIDTH);
  if (offset < 0) {
    return [offset + d * BIG_GRID_WIDTH, -d];
  }
  return [offset - d * BIG_GRID_WIDTH, d];
}

/**
 * Sort positions array and keep shapes in sync.
 */
function sortSynced(positions: number[], shapes: SegmentType[]): { positions: number[]; shapes: SegmentType[] } {
  const indices = positions.map((_, i) => i);
  indices.sort((a, b) => positions[a] - positions[b]);
  return {
    positions: indices.map(i => positions[i]),
    shapes: indices.map(i => shapes[i]),
  };
}

/**
 * Normalize positions so the minimum position is at (0,0).
 */
function normalizePositions(positions: number[]): number[] {
  let minCol = BIG_GRID_WIDTH;
  let minRow = BIG_GRID_HEIGHT;
  for (const pos of positions) {
    const col = pos % BIG_GRID_WIDTH;
    const row = Math.floor(pos / BIG_GRID_WIDTH);
    if (col < minCol) minCol = col;
    if (row < minRow) minRow = row;
  }
  return positions.map(p => p - (minRow * BIG_GRID_HEIGHT + minCol));
}

/**
 * Check if two orientations are identical.
 */
function isIdentical(
  posA: number[], shapesA: SegmentType[],
  posB: number[], shapesB: SegmentType[],
): boolean {
  if (posA.length !== posB.length) return false;
  for (let i = 0; i < posA.length; i++) {
    if (posA[i] !== posB[i] || shapesA[i] !== shapesB[i]) return false;
  }
  return true;
}

/**
 * Compute all unique orientations for a piece defined on the big grid.
 *
 * Returns an array of normalized position sets (up to 8 orientations).
 */
function findAllOrientationsBigGrid(
  initialPositions: readonly number[],
  initialShapes: readonly SegmentType[],
): Array<{ bigGridPositions: number[]; shapes: SegmentType[] }> {
  const results: Array<{ bigGridPositions: number[]; shapes: SegmentType[] }> = [];

  // Start with the canonical orientation
  const normalized = normalizePositions([...initialPositions]);
  const sorted0 = sortSynced(normalized, [...initialShapes]);
  results.push({ bigGridPositions: sorted0.positions, shapes: sorted0.shapes });

  // Get keys for rotation/reflection
  const basePositions = sorted0.positions;
  const baseShapes = sorted0.shapes;

  // Find min to translate to origin
  let min = BIG_GRID_WIDTH * BIG_GRID_HEIGHT;
  for (const p of basePositions) if (p < min) min = p;
  const translated = basePositions.map(p => p - min);

  const keys = translated.map(p => getKeys(p));

  // Apply 3 rotations
  for (let r = 0; r < ROTATIONS.length; r++) {
    const [rA, rB] = ROTATIONS[r];
    let rotated = keys.map(([kc, kr]) => kc * rA + kr * rB);

    // Center
    const center = Math.floor(BIG_GRID_HEIGHT / 2) * BIG_GRID_WIDTH + Math.floor(BIG_GRID_WIDTH / 2);
    rotated = rotated.map(p => p + center);

    // Normalize
    const normRot = normalizePositions(rotated);
    const newShapes = baseShapes.map(s => ROTATION_SHAPE[r][s]);
    const sorted = sortSynced(normRot, newShapes);

    // Check duplicates
    let isDuplicate = false;
    for (const existing of results) {
      if (isIdentical(existing.bigGridPositions, existing.shapes, sorted.positions, sorted.shapes)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      results.push({ bigGridPositions: sorted.positions, shapes: sorted.shapes });
    }
  }

  // Apply reflection
  let reflected = keys.map(([kc, kr]) => kc * REFLECTION[0] + kr * REFLECTION[1]);
  const center = Math.floor(BIG_GRID_HEIGHT / 2) * BIG_GRID_WIDTH + Math.floor(BIG_GRID_WIDTH / 2);
  reflected = reflected.map(p => p + center);
  const normRef = normalizePositions(reflected);
  const refShapes = baseShapes.map(s => REFLECTION_SHAPE[s]);
  const sortedRef = sortSynced(normRef, refShapes);

  let isRefDuplicate = false;
  for (const existing of results) {
    if (isIdentical(existing.bigGridPositions, existing.shapes, sortedRef.positions, sortedRef.shapes)) {
      isRefDuplicate = true;
      break;
    }
  }

  if (!isRefDuplicate) {
    results.push({ bigGridPositions: sortedRef.positions, shapes: sortedRef.shapes });

    // Apply 3 rotations to the reflected version
    let minR = BIG_GRID_WIDTH * BIG_GRID_HEIGHT;
    for (const p of sortedRef.positions) if (p < minR) minR = p;
    const translatedRef = sortedRef.positions.map(p => p - minR);
    const keysRef = translatedRef.map(p => getKeys(p));

    for (let r = 0; r < ROTATIONS.length; r++) {
      const [rA, rB] = ROTATIONS[r];
      let rotated = keysRef.map(([kc, kr]) => kc * rA + kr * rB);
      rotated = rotated.map(p => p + center);
      const normRot = normalizePositions(rotated);
      const newShapes = sortedRef.shapes.map(s => ROTATION_SHAPE[r][s]);
      const sorted = sortSynced(normRot, newShapes);

      let isDuplicate = false;
      for (const existing of results) {
        if (isIdentical(existing.bigGridPositions, existing.shapes, sorted.positions, sorted.shapes)) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        results.push({ bigGridPositions: sorted.positions, shapes: sorted.shapes });
      }
    }
  }

  return results;
}

/**
 * Convert big-grid (40×40) positions to small-grid (14×14) positions.
 * Returns null if the piece doesn't fit on the 14×14 grid.
 */
function adjustToSmallGrid(bigGridPositions: number[]): number[] | null {
  let maxCol = -1;
  let maxRow = -1;
  for (const pos of bigGridPositions) {
    const col = pos % BIG_GRID_WIDTH;
    const row = Math.floor(pos / BIG_GRID_WIDTH);
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;
  }
  const SMALL_WIDTH = 14;
  const SMALL_HEIGHT = 14;
  if (maxCol >= SMALL_WIDTH || maxRow >= SMALL_HEIGHT) return null;

  return bigGridPositions.map(p => {
    const col = p % BIG_GRID_WIDTH;
    const row = Math.floor(p / BIG_GRID_WIDTH);
    return row * SMALL_WIDTH + col;
  });
}

// ─── Pre-computed Orientations ───────────────────────────

/** All unique orientations for each piece, with positions on the 14×14 grid. */
export const ALL_ORIENTATIONS: readonly (readonly PieceOrientation[])[] = (() => {
  const result: PieceOrientation[][] = [];

  for (let piece = 0; piece < NUM_PIECES; piece++) {
    const bigGridOrientations = findAllOrientationsBigGrid(
      PIECE_INITIAL_POSITIONS[piece],
      PIECE_SHAPES[piece],
    );

    const smallGridOrientations: PieceOrientation[] = [];
    for (const orient of bigGridOrientations) {
      const smallPositions = adjustToSmallGrid(orient.bigGridPositions);
      if (smallPositions) {
        smallGridOrientations.push({
          positions: smallPositions,
          shapes: orient.shapes,
        });
      }
    }
    result.push(smallGridOrientations);
  }

  return result;
})();

/**
 * Piece Orientation Generator — rotations and reflections.
 * Ported from BigGridNoodles.java.
 */

import {
  CURVE, CROSS_NS, CROSS_EW,
  PIECE_INITIAL_POSITIONS,
  PIECE_SHAPES,
  NUM_PIECES,
  type SegmentType,
} from './pieces';

const BIG_GRID_WIDTH = 40;

/** Rotation matrices applied to [col_key, row_key] pairs */
const ROTATIONS: readonly [number, number][] = [
  [-BIG_GRID_WIDTH, 1],   // 90 CW
  [-1, -BIG_GRID_WIDTH],  // 180
  [BIG_GRID_WIDTH, -1],   // 270 CW
];

/** How segment types transform under each rotation */
const ROTATION_SHAPE: readonly (readonly SegmentType[])[] = [
  [CURVE, CROSS_EW, CROSS_NS],  // 90
  [CURVE, CROSS_NS, CROSS_EW],  // 180
  [CURVE, CROSS_EW, CROSS_NS],  // 270
];

const REFLECTION: readonly number[] = [1, -BIG_GRID_WIDTH];
const REFLECTION_SHAPE: readonly SegmentType[] = [CURVE, CROSS_EW, CROSS_NS];

export interface PieceOrientation {
  positions: number[];
  shapes: SegmentType[];
}

function getKeys(offset: number): [number, number] {
  const d = Math.floor((Math.abs(offset) + 10) / BIG_GRID_WIDTH);
  if (offset < 0) return [offset + d * BIG_GRID_WIDTH, -d];
  return [offset - d * BIG_GRID_WIDTH, d];
}

function sortSynced(positions: number[], shapes: SegmentType[]): { positions: number[]; shapes: SegmentType[] } {
  const indices = positions.map((_, i) => i);
  indices.sort((a, b) => positions[a] - positions[b]);
  return {
    positions: indices.map(i => positions[i]),
    shapes: indices.map(i => shapes[i]),
  };
}

function normalizePositions(positions: number[]): number[] {
  let minCol = BIG_GRID_WIDTH;
  let minRow = BIG_GRID_WIDTH;
  for (const pos of positions) {
    const col = pos % BIG_GRID_WIDTH;
    const row = Math.floor(pos / BIG_GRID_WIDTH);
    if (col < minCol) minCol = col;
    if (row < minRow) minRow = row;
  }
  return positions.map(p => p - (minRow * BIG_GRID_WIDTH + minCol));
}

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

function findAllOrientationsBigGrid(
  initialPositions: readonly number[],
  initialShapes: readonly SegmentType[],
): Array<{ bigGridPositions: number[]; shapes: SegmentType[] }> {
  const results: Array<{ bigGridPositions: number[]; shapes: SegmentType[] }> = [];

  const normalized = normalizePositions([...initialPositions]);
  const sorted0 = sortSynced(normalized, [...initialShapes]);
  results.push({ bigGridPositions: sorted0.positions, shapes: sorted0.shapes });

  const basePositions = sorted0.positions;
  const baseShapes = sorted0.shapes;

  let min = BIG_GRID_WIDTH * BIG_GRID_WIDTH;
  for (const p of basePositions) if (p < min) min = p;
  const translated = basePositions.map(p => p - min);
  const keys = translated.map(p => getKeys(p));

  const center = Math.floor(BIG_GRID_WIDTH / 2) * BIG_GRID_WIDTH + Math.floor(BIG_GRID_WIDTH / 2);

  // 3 rotations
  for (let r = 0; r < ROTATIONS.length; r++) {
    const [rA, rB] = ROTATIONS[r];
    let rotated = keys.map(([kc, kr]) => kc * rA + kr * rB);
    rotated = rotated.map(p => p + center);
    const normRot = normalizePositions(rotated);
    const newShapes = baseShapes.map(s => ROTATION_SHAPE[r][s]);
    const sorted = sortSynced(normRot, newShapes);

    let isDuplicate = false;
    for (const existing of results) {
      if (isIdentical(existing.bigGridPositions, existing.shapes, sorted.positions, sorted.shapes)) {
        isDuplicate = true; break;
      }
    }
    if (!isDuplicate) results.push({ bigGridPositions: sorted.positions, shapes: sorted.shapes });
  }

  // Reflection
  let reflected = keys.map(([kc, kr]) => kc * REFLECTION[0] + kr * REFLECTION[1]);
  reflected = reflected.map(p => p + center);
  const normRef = normalizePositions(reflected);
  const refShapes = baseShapes.map(s => REFLECTION_SHAPE[s]);
  const sortedRef = sortSynced(normRef, refShapes);

  let isRefDuplicate = false;
  for (const existing of results) {
    if (isIdentical(existing.bigGridPositions, existing.shapes, sortedRef.positions, sortedRef.shapes)) {
      isRefDuplicate = true; break;
    }
  }

  if (!isRefDuplicate) {
    results.push({ bigGridPositions: sortedRef.positions, shapes: sortedRef.shapes });

    let minR = BIG_GRID_WIDTH * BIG_GRID_WIDTH;
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
          isDuplicate = true; break;
        }
      }
      if (!isDuplicate) results.push({ bigGridPositions: sorted.positions, shapes: sorted.shapes });
    }
  }

  return results;
}

function adjustToSmallGrid(bigGridPositions: number[]): number[] | null {
  let maxCol = -1;
  let maxRow = -1;
  for (const pos of bigGridPositions) {
    const col = pos % BIG_GRID_WIDTH;
    const row = Math.floor(pos / BIG_GRID_WIDTH);
    if (col > maxCol) maxCol = col;
    if (row > maxRow) maxRow = row;
  }
  if (maxCol >= 14 || maxRow >= 14) return null;
  return bigGridPositions.map(p => {
    const col = p % BIG_GRID_WIDTH;
    const row = Math.floor(p / BIG_GRID_WIDTH);
    return row * 14 + col;
  });
}

/** All unique orientations per piece, positions on the 14x14 grid */
export const ALL_ORIENTATIONS: readonly (readonly PieceOrientation[])[] = (() => {
  const result: PieceOrientation[][] = [];
  for (let piece = 0; piece < NUM_PIECES; piece++) {
    const bigOrientations = findAllOrientationsBigGrid(
      PIECE_INITIAL_POSITIONS[piece],
      PIECE_SHAPES[piece],
    );
    const smallOrientations: PieceOrientation[] = [];
    for (const orient of bigOrientations) {
      const small = adjustToSmallGrid(orient.bigGridPositions);
      if (small) smallOrientations.push({ positions: small, shapes: orient.shapes });
    }
    result.push(smallOrientations);
  }
  return result;
})();

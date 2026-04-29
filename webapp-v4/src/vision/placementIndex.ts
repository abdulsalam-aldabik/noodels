/**
 * Module-load cached index of canonical placements per piece class, keyed by
 * classId. Each canonical placement carries:
 *   - a Set<number> of occupied cell keys (row*14+col)
 *   - a 14-entry row bitmask (Uint16Array) for fast popcount/AND/OR
 *   - orientation/rotation/mirrored metadata
 *   - topLeftCell (lexicographically smallest occupied cell)
 *
 * Duplicate (orientation, translation) pairs collapsing onto the same cell set
 * are dropped; a single console.warn records the dedupe count.
 */

import { generatePlacementsForAllPieces } from "../engine/placements";

export interface CanonicalPlacement {
  classId: number;
  orientationIndex: number;
  rotationSteps: 0 | 1 | 2 | 3;
  mirrored: boolean;
  cellSet: Set<number>;
  rowBitmap: Uint16Array; // length 14
  topLeftCell: { row: number; col: number };
  size: number;
}

let cached: Map<number, CanonicalPlacement[]> | null = null;

export function getPlacementIndex(): Map<number, CanonicalPlacement[]> {
  if (cached) return cached;
  const index = new Map<number, CanonicalPlacement[]>();
  const seenPerClass = new Map<number, Set<string>>();
  let dedupes = 0;

  const allByPiece = generatePlacementsForAllPieces();
  allByPiece.forEach((pieceList, classId) => {
    const entries: CanonicalPlacement[] = [];
    const seen = new Set<string>();
    seenPerClass.set(classId, seen);

    for (const pl of pieceList) {
      const cellSet = new Set<number>();
      const rowBitmap = new Uint16Array(14);
      let topRow = 14;
      let topCol = 14;
      for (const pos of pl.positions) {
        const row = Math.floor(pos / 14);
        const col = pos % 14;
        const key = row * 14 + col;
        cellSet.add(key);
        rowBitmap[row] |= 1 << col;
        if (row < topRow || (row === topRow && col < topCol)) {
          topRow = row;
          topCol = col;
        }
      }
      const sortedKey = [...cellSet].sort((a, b) => a - b).join(",");
      if (seen.has(sortedKey)) {
        dedupes++;
        continue;
      }
      seen.add(sortedKey);
      const rotationSteps = (pl.rotationSteps ?? 0) as 0 | 1 | 2 | 3;
      entries.push({
        classId,
        orientationIndex: pl.orientationIndex,
        rotationSteps,
        mirrored: Boolean(pl.mirrored),
        cellSet,
        rowBitmap,
        topLeftCell: { row: topRow, col: topCol },
        size: cellSet.size,
      });
    }
    index.set(classId, entries);
  });

  if (dedupes > 0) {
    console.warn(
      `[placementIndex] dropped ${dedupes} duplicate (orientation, translation) placements`,
    );
  }

  cached = index;
  return cached;
}

/** Count 1-bits in a 14-row bitmap. */
export function popcountRowBitmap(bitmap: Uint16Array): number {
  let n = 0;
  for (let i = 0; i < bitmap.length; i++) {
    let v = bitmap[i];
    while (v) {
      v &= v - 1;
      n++;
    }
  }
  return n;
}

export function andRowBitmaps(a: Uint16Array, b: Uint16Array): Uint16Array {
  const len = Math.min(a.length, b.length);
  const out = new Uint16Array(len);
  for (let i = 0; i < len; i++) out[i] = a[i] & b[i];
  return out;
}

export function orRowBitmaps(a: Uint16Array, b: Uint16Array): Uint16Array {
  const len = Math.max(a.length, b.length);
  const out = new Uint16Array(len);
  for (let i = 0; i < len; i++) out[i] = (a[i] ?? 0) | (b[i] ?? 0);
  return out;
}

export function cellSetIoU(a: Uint16Array, b: Uint16Array): number {
  const inter = popcountRowBitmap(andRowBitmaps(a, b));
  const union = popcountRowBitmap(orRowBitmaps(a, b));
  if (union === 0) return 0;
  return inter / union;
}

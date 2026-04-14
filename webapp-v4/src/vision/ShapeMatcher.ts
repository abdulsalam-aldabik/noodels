import { BOARD_WIDTH } from "../engine/constants";
import { generatePlacementsForPiece } from "../engine/placements";
import type { PiecePlacement } from "../engine/types";

/**
 * Computes how well a detection's mask footprint matches a candidate placement's
 * footprint in a normalized grid. Returns 0–1 (1 = perfect match).
 *
 * Uses edge-IoU: rasterizes both shapes into a small grid and compares overlap
 * of edge pixels (boundary cells). This is more discriminative than area IoU
 * for thin, elongated noodle pieces.
 */

const GRID = 32;

function rasterizePositions(positions: number[], boardW: number): Uint8Array {
  const grid = new Uint8Array(GRID * GRID);
  if (positions.length === 0) return grid;

  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (const pos of positions) {
    const r = Math.floor(pos / boardW);
    const c = pos % boardW;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }

  const rangeR = maxR - minR + 1;
  const rangeC = maxC - minC + 1;

  for (const pos of positions) {
    const r = Math.floor(pos / boardW);
    const c = pos % boardW;
    const gr = Math.floor(((r - minR) / rangeR) * (GRID - 1));
    const gc = Math.floor(((c - minC) / rangeC) * (GRID - 1));
    grid[gr * GRID + gc] = 1;
  }
  return grid;
}

function rasterizeMaskPoints(
  points: [number, number][],
): Uint8Array {
  const grid = new Uint8Array(GRID * GRID);
  if (points.length === 0) return grid;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  for (const [x, y] of points) {
    const gc = Math.min(GRID - 1, Math.floor(((x - minX) / rangeX) * (GRID - 1)));
    const gr = Math.min(GRID - 1, Math.floor(((y - minY) / rangeY) * (GRID - 1)));
    grid[gr * GRID + gc] = 1;
  }
  return grid;
}

function extractEdges(grid: Uint8Array): Uint8Array {
  const edges = new Uint8Array(GRID * GRID);
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (!grid[r * GRID + c]) continue;
      // Is border if any 4-neighbor is empty or out of bounds
      const isBorder =
        r === 0 || r === GRID - 1 || c === 0 || c === GRID - 1 ||
        !grid[(r - 1) * GRID + c] || !grid[(r + 1) * GRID + c] ||
        !grid[r * GRID + c - 1] || !grid[r * GRID + c + 1];
      if (isBorder) edges[r * GRID + c] = 1;
    }
  }
  return edges;
}

function edgeIoU(a: Uint8Array, b: Uint8Array): number {
  const ea = extractEdges(a);
  const eb = extractEdges(b);
  let inter = 0, union = 0;
  for (let i = 0; i < GRID * GRID; i++) {
    const va = ea[i], vb = eb[i];
    if (va || vb) union++;
    if (va && vb) inter++;
  }
  return union === 0 ? 0 : inter / union;
}

/**
 * Scores how well a detection mask matches a specific engine placement.
 * @param maskPoints  Mask polygon points in board-grid space
 * @param placement   Engine placement to compare against
 * @returns 0–1 shape fit score
 */
export function shapeFitScore(
  maskPoints: [number, number][],
  placement: PiecePlacement,
): number {
  const maskGrid = rasterizeMaskPoints(maskPoints);
  const placementGrid = rasterizePositions(placement.positions, BOARD_WIDTH);
  return edgeIoU(maskGrid, placementGrid);
}

/**
 * For a given piece class, finds the placement whose shape best matches the mask.
 * Returns the best score and the matching placement.
 */
export function findBestShapeMatch(
  classId: number,
  maskPoints: [number, number][],
  centerRow: number,
  centerCol: number,
  maxSearchRadius = 3,
): { score: number; placement: PiecePlacement } | null {
  const allPlacements = generatePlacementsForPiece(classId);
  if (allPlacements.length === 0) return null;

  const maskGrid = rasterizeMaskPoints(maskPoints);
  let bestScore = -1;
  let bestPlacement: PiecePlacement | null = null;

  for (const p of allPlacements) {
    // Quick spatial filter: placement centroid must be near detected centroid
    let sumR = 0, sumC = 0;
    for (const pos of p.positions) {
      sumR += Math.floor(pos / BOARD_WIDTH);
      sumC += pos % BOARD_WIDTH;
    }
    const avgR = sumR / p.positions.length;
    const avgC = sumC / p.positions.length;
    const dist = Math.abs(avgR - centerRow) + Math.abs(avgC - centerCol);
    if (dist > maxSearchRadius * 2) continue;

    const pGrid = rasterizePositions(p.positions, BOARD_WIDTH);
    const score = edgeIoU(maskGrid, pGrid);
    if (score > bestScore) {
      bestScore = score;
      bestPlacement = p;
    }
  }

  return bestPlacement ? { score: bestScore, placement: bestPlacement } : null;
}

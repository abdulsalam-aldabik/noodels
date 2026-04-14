import { BOARD_WIDTH } from "../engine/constants";
import { generatePlacementsForPiece } from "../engine/placements";
import { pointInPolygon } from "./PieceMapper";
import { shapeFitScore } from "./ShapeMatcher";
import { VALID_CELLS } from "./boardCells";
import type { PiecePlacement } from "../engine/types";

/**
 * Minimum coverage IoU to accept a cell-coverage match.
 * Below this threshold we fall back to centroid-nearest.
 */
export const MIN_COVERAGE_IOU = 0.15;

// ── Cell rasterization ──────────────────────────────────────────────────────

/**
 * Rasterizes a projected mask polygon onto the 14×14 board grid.
 *
 * For each valid board cell, tests whether its center lies inside the mask
 * polygon. Uses sub-sampling (4 corner points offset inward by 0.25) and
 * requires ≥2 inside to absorb sub-pixel jitter from the homography.
 *
 * @param boardMaskPoints  Mask polygon vertices in board-grid coordinates
 *                         (col, row — as produced by the homography).
 * @returns Set of linear cell indices (r * BOARD_WIDTH + c) covered by the mask.
 */
export function rasterizeMaskToBoardCells(
  boardMaskPoints: [number, number][],
): Set<number> {
  const covered = new Set<number>();
  if (boardMaskPoints.length < 3) return covered;

  for (const [r, c] of VALID_CELLS) {
    // Sub-sample 4 points around the cell center (offset 0.25 inward)
    const offsets: [number, number][] = [
      [c - 0.25, r - 0.25],
      [c + 0.25, r - 0.25],
      [c - 0.25, r + 0.25],
      [c + 0.25, r + 0.25],
    ];

    let insideCount = 0;
    for (const [px, py] of offsets) {
      if (pointInPolygon(px, py, boardMaskPoints)) {
        insideCount++;
      }
    }

    // Also test center
    if (pointInPolygon(c, r, boardMaskPoints)) {
      insideCount++;
    }

    // Require center + at least 1 corner, or ≥2 corners
    if (insideCount >= 2) {
      covered.add(r * BOARD_WIDTH + c);
    }
  }

  return covered;
}

// ── IoU scoring ─────────────────────────────────────────────────────────────

/**
 * Standard Jaccard IoU between two sets of cell indices.
 */
export function cellIoU(
  coveredCells: Set<number>,
  placement: PiecePlacement,
): number {
  const placementSet = new Set(placement.positions);
  let intersection = 0;

  for (const cell of coveredCells) {
    if (placementSet.has(cell)) intersection++;
  }

  const union = coveredCells.size + placementSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Best placement finder ───────────────────────────────────────────────────

export interface CoveragePlacementResult {
  placement: PiecePlacement;
  score: number;
}

/**
 * Finds the engine placement whose cell footprint best matches the
 * rasterized mask coverage. Returns the highest-IoU placement, breaking
 * ties with `shapeFitScore`.
 *
 * Because each engine placement carries a unique (rotationSteps, mirrored)
 * tag, picking the right cell footprint automatically picks the correct
 * rotation and flip.
 *
 * @param classId        Piece class id (0–10)
 * @param coveredCells   Set of cell indices covered by the projected mask
 * @param requiredPos    Optional required anchor cell (linear index). If set,
 *                       only placements covering this cell are considered.
 * @param maskPoints     Optional mask polygon in board-grid space for tie-breaking
 * @returns Best placement and its IoU score, or null if no placements exist.
 */
export function findBestPlacementByCoverage(
  classId: number,
  coveredCells: Set<number>,
  requiredPos?: number,
  maskPoints?: [number, number][],
): CoveragePlacementResult | null {
  const allPlacements = generatePlacementsForPiece(classId).filter((p) =>
    requiredPos === undefined ? true : p.positions.includes(requiredPos),
  );
  if (allPlacements.length === 0) return null;

  let bestPlacement: PiecePlacement | null = null;
  let bestIoU = -1;
  let bestTieBreaker = -1;

  for (const p of allPlacements) {
    const iou = cellIoU(coveredCells, p);
    if (iou < bestIoU) continue;

    // Tie-break: use shape fit score if mask points available
    let tieBreaker = 0;
    if (iou === bestIoU && maskPoints && maskPoints.length > 3) {
      tieBreaker = shapeFitScore(maskPoints, p);
      if (tieBreaker <= bestTieBreaker) continue;
    }

    if (iou > bestIoU || tieBreaker > bestTieBreaker) {
      bestIoU = iou;
      bestPlacement = p;
      bestTieBreaker = maskPoints && maskPoints.length > 3
        ? shapeFitScore(maskPoints, p)
        : 0;
    }
  }

  return bestPlacement ? { placement: bestPlacement, score: bestIoU } : null;
}

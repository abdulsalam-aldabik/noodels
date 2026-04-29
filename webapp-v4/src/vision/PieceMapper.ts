/**
 * PieceMapper — Combined color + YOLO-mask piece placement.
 *
 * Algorithm:
 *   1. Color-classify every board cell (Lab distance to reference colors).
 *   2. For each YOLO piece detection above threshold, warp its mask into
 *      board space and collect the cells it covers.
 *   3. For each piece class, the candidate cell set is the union of color
 *      cells and YOLO-mask cells. This lets YOLO rescue pieces that color
 *      missed (glare, white-balance shift) without losing color's coverage
 *      on tightly-packed boards where masks blur together.
 *   4. Fit against canonical placements (max hit-count wins).
 *   5. Greedy global assignment with conflict resolution.
 */

import {
  PIECE_CLASS_COUNT,
  type RawDetection,
  CLASS_NAMES,
} from "../inference/types";
import {
  classifyCellsByColor,
  whiteBalanceRectifiedCanvas,
  type ColorClassificationResult,
} from "./ColorCellClassifier";
import {
  getPlacementsByClass,
  type PinVisitPlacement,
} from "./PinPairIndex";
import { warpMaskToCells } from "./maskToBoardGrid";
import type {
  BoardState,
  Homography,
  PieceMapStats,
  PieceOrientation,
  PiecePlacement,
} from "./types";

/** Minimum YOLO score for a detection to contribute mask cells. */
export const YOLO_PIECE_MIN_SCORE = 0.25;
/** Below this color-cell count the placement is considered YOLO-rescued. */
const COLOR_CELL_RESCUE_THRESHOLD = 2;

// ── Types ────────────────────────────────────────────────────────────────────

interface CandidateMatch {
  classId: number;
  placement: PinVisitPlacement;
  hitCount: number;
  hitRatio: number;
  extraCells: number;
  yoloBacked: boolean;
  /** True when color found < COLOR_CELL_RESCUE_THRESHOLD cells; cell set was supplied by YOLO mask. */
  yoloRescued: boolean;
  sourceCells: Set<number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rotationToOrientation(steps: 0 | 1 | 2 | 3): PieceOrientation {
  return (steps * 90) as PieceOrientation;
}

/** Find the canonical placement that best covers the given cell set. */
export function fitBestPlacement(
  classId: number,
  candidateCells: Set<number>,
): { placement: PinVisitPlacement; hitCount: number; extraCells: number } | null {
  if (candidateCells.size < 2) return null;
  const placements = getPlacementsByClass(classId);
  let bestHitCount = 0;
  let bestPlacement: PinVisitPlacement | null = null;
  let bestExtra = Infinity;
  for (const pl of placements) {
    let hits = 0;
    for (const cellKey of pl.cellSet) {
      if (candidateCells.has(cellKey)) hits++;
    }
    if (hits === 0) continue;
    const extra = candidateCells.size - hits;
    if (hits > bestHitCount || (hits === bestHitCount && extra < bestExtra)) {
      bestHitCount = hits;
      bestPlacement = pl;
      bestExtra = extra;
    }
  }
  if (!bestPlacement || bestHitCount < 2) return null;
  return { placement: bestPlacement, hitCount: bestHitCount, extraCells: bestExtra };
}

/**
 * For each YOLO piece detection above {@link YOLO_PIECE_MIN_SCORE}, project its
 * mask into board space using the supplied homography and collect cells covered
 * above the default coverage threshold. When multiple detections share a class,
 * the union of their cells is taken.
 *
 * Returns an empty map if no homography is supplied — color-only fallback.
 */
function buildYoloMaskCellsByClass(
  detections: RawDetection[],
  homography?: Homography,
): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  if (!homography) return out;

  for (const det of detections) {
    if (det.classId < 0 || det.classId >= PIECE_CLASS_COUNT) continue;
    if (det.score < YOLO_PIECE_MIN_SCORE) continue;
    const warp = warpMaskToCells(det, homography.forward);
    if (warp.totalCells === 0) continue;
    let bucket = out.get(det.classId);
    if (!bucket) { bucket = new Set(); out.set(det.classId, bucket); }
    for (let i = 0; i < 196; i++) {
      if (warp.cellMask[i]) bucket.add(i);
    }
  }
  return out;
}

// ── Main mapper ──────────────────────────────────────────────────────────────

export function mapPiecesToBoardState(
  rectifiedCanvas: HTMLCanvasElement,
  detections: RawDetection[],
  homography?: Homography,
): BoardState {
  // Which classes YOLO also detected — used for conflict priority and mask rescue.
  const yoloClassIds = new Set<number>();
  for (const det of detections) {
    if (det.classId >= 0 && det.classId < PIECE_CLASS_COUNT && det.score >= YOLO_PIECE_MIN_SCORE) {
      yoloClassIds.add(det.classId);
    }
  }

  // White-balance the rectified canvas using known board-frame regions
  // (mutates in place). Stabilizes color classification across phone cameras
  // with different auto-WB behavior.
  whiteBalanceRectifiedCanvas(rectifiedCanvas);

  // Color-classify every board cell.
  const colorResult = classifyCellsByColor(rectifiedCanvas);

  // Group cells by piece class (color-driven).
  const colorCellsByClass = new Map<number, Set<number>>();
  for (const cell of colorResult.cells) {
    if (cell.classId < 0) continue;
    let set = colorCellsByClass.get(cell.classId);
    if (!set) { set = new Set(); colorCellsByClass.set(cell.classId, set); }
    set.add(cell.cellIndex);
  }

  // YOLO-mask rescue: project each piece detection's mask into board space and
  // collect the cells it covers. This recovers pieces that color missed under
  // glare or white-balance shift.
  const yoloCellsByClass = buildYoloMaskCellsByClass(detections, homography);

  // Build the union (color ∪ YOLO mask) cell set per class — the candidate pool.
  const cellsByClass = new Map<number, { cells: Set<number>; colorCount: number }>();
  for (const [classId, colorCells] of colorCellsByClass) {
    cellsByClass.set(classId, { cells: new Set(colorCells), colorCount: colorCells.size });
  }
  for (const [classId, maskCells] of yoloCellsByClass) {
    let entry = cellsByClass.get(classId);
    if (!entry) {
      entry = { cells: new Set(), colorCount: 0 };
      cellsByClass.set(classId, entry);
    }
    for (const cell of maskCells) entry.cells.add(cell);
  }

  // Best placement per class.
  const candidates: CandidateMatch[] = [];
  for (const [classId, entry] of cellsByClass) {
    const fit = fitBestPlacement(classId, entry.cells);
    if (!fit) continue;
    candidates.push({
      classId,
      placement: fit.placement,
      hitCount: fit.hitCount,
      hitRatio: fit.hitCount / fit.placement.cellSet.size,
      extraCells: fit.extraCells,
      yoloBacked: yoloClassIds.has(classId),
      yoloRescued: entry.colorCount < COLOR_CELL_RESCUE_THRESHOLD && yoloCellsByClass.has(classId),
      sourceCells: entry.cells,
    });
  }

  // YOLO-backed candidates resolve conflicts before color-only ones.
  candidates.sort((a, b) => {
    if (a.yoloBacked !== b.yoloBacked) return a.yoloBacked ? -1 : 1;
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return a.extraCells - b.extraCells;
  });

  const occupiedCells = new Set<number>();
  const usedClassIds = new Set<number>();
  const placementsOut: PiecePlacement[] = [];

  for (const cand of candidates) {
    if (usedClassIds.has(cand.classId)) continue;
    let collides = false;
    for (const cellKey of cand.placement.cellSet) {
      if (occupiedCells.has(cellKey)) { collides = true; break; }
    }
    if (collides) continue;

    for (const cellKey of cand.placement.cellSet) occupiedCells.add(cellKey);
    usedClassIds.add(cand.classId);

    // Ambiguity: gap between best and runner-up orientation.
    let runnerUpHits = 0;
    for (const pl of getPlacementsByClass(cand.classId)) {
      if (pl === cand.placement) continue;
      if (pl.rotationSteps === cand.placement.rotationSteps && pl.mirrored === cand.placement.mirrored) continue;
      let hits = 0;
      for (const c of pl.cellSet) if (cand.sourceCells.has(c)) hits++;
      if (hits > runnerUpHits) runnerUpHits = hits;
    }
    const ambiguous = cand.hitCount - runnerUpHits < 2;

    placementsOut.push({
      classId: cand.classId,
      className: CLASS_NAMES[cand.classId],
      cell: { row: cand.placement.topLeftCell.row, col: cand.placement.topLeftCell.col },
      orientation: rotationToOrientation(cand.placement.rotationSteps),
      mirrored: cand.placement.mirrored,
      confidence: Math.min(1, cand.hitRatio),
      ambiguous,
      source: cand.yoloRescued ? "yolo-mask" : "color-rescue",
      canonicalPositions: [...cand.placement.cellSet],
      canonicalOrientationIndex: cand.placement.orientationIndex,
    });
  }

  const unassignedDetections: RawDetection[] = [];
  for (const det of detections) {
    if (det.classId >= 0 && det.classId < PIECE_CLASS_COUNT && !usedClassIds.has(det.classId)) {
      unassignedDetections.push(det);
    }
  }

  let maskCount = 0, colorRescueCount = 0;
  for (const p of placementsOut) {
    if (p.source === "yolo-mask") maskCount++;
    else colorRescueCount++;
  }

  const stats: PieceMapStats = { maskCount, colorRescueCount, droppedColorClassIds: [] };

  return { placements: placementsOut, unassignedDetections, stats };
}

// ── Debug export ─────────────────────────────────────────────────────────────

export function getColorClassification(
  rectifiedCanvas: HTMLCanvasElement,
): ColorClassificationResult {
  return classifyCellsByColor(rectifiedCanvas);
}

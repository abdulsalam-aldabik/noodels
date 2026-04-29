/**
 * PieceMapper — Color-primary piece placement with YOLO priority.
 *
 * Algorithm:
 *   1. Color-classify every board cell (Lab distance to reference colors).
 *   2. For each piece class, gather all cells that color says belong to it.
 *   3. Fit against canonical placements (max hit-count wins).
 *   4. Greedy global assignment: YOLO-detected classes win conflicts; within
 *      each tier, sort by hit count then fewest extra cells.
 *
 * YOLO is used purely as a tie-breaker signal — if two classes conflict for
 * the same cells, the one YOLO also detected takes priority. Color drives the
 * actual cell occupancy, which is more robust to illumination than mask warp.
 */

import {
  PIECE_CLASS_COUNT,
  type RawDetection,
  CLASS_NAMES,
} from "../inference/types";
import {
  classifyCellsByColor,
  type ColorClassificationResult,
} from "./ColorCellClassifier";
import {
  getPlacementsByClass,
  type PinVisitPlacement,
} from "./PinPairIndex";
import type {
  BoardState,
  Homography,
  PieceMapStats,
  PieceOrientation,
  PiecePlacement,
} from "./types";

/** Minimum YOLO score for a detection to boost a class's assignment priority. */
export const YOLO_PIECE_MIN_SCORE = 0.25;

// ── Types ────────────────────────────────────────────────────────────────────

interface CandidateMatch {
  classId: number;
  placement: PinVisitPlacement;
  hitCount: number;
  hitRatio: number;
  extraCells: number;
  yoloBacked: boolean;
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

// ── Main mapper ──────────────────────────────────────────────────────────────

export function mapPiecesToBoardState(
  rectifiedCanvas: HTMLCanvasElement,
  detections: RawDetection[],
  _homography?: Homography,
): BoardState {
  // Which classes YOLO also detected — used only for conflict priority.
  const yoloClassIds = new Set<number>();
  for (const det of detections) {
    if (det.classId >= 0 && det.classId < PIECE_CLASS_COUNT && det.score >= YOLO_PIECE_MIN_SCORE) {
      yoloClassIds.add(det.classId);
    }
  }

  // Color-classify every board cell.
  const colorResult = classifyCellsByColor(rectifiedCanvas);

  // Group cells by piece class.
  const cellsByClass = new Map<number, Set<number>>();
  for (const cell of colorResult.cells) {
    if (cell.classId < 0) continue;
    let set = cellsByClass.get(cell.classId);
    if (!set) { set = new Set(); cellsByClass.set(cell.classId, set); }
    set.add(cell.cellIndex);
  }

  // Best placement per class.
  const candidates: CandidateMatch[] = [];
  for (const [classId, colorCells] of cellsByClass) {
    const fit = fitBestPlacement(classId, colorCells);
    if (!fit) continue;
    candidates.push({
      classId,
      placement: fit.placement,
      hitCount: fit.hitCount,
      hitRatio: fit.hitCount / fit.placement.cellSet.size,
      extraCells: fit.extraCells,
      yoloBacked: yoloClassIds.has(classId),
      sourceCells: colorCells,
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
      source: cand.yoloBacked ? "yolo-mask" : "color-rescue",
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

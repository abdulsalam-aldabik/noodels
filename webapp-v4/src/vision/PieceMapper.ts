/**
 * PieceMapper — Color-primary with YOLO priority boosting.
 *
 * Algorithm:
 *   1. Color-classify every board cell (Lab distance to reference colors).
 *   2. For each piece class, fit color cells against canonical placements.
 *   3. YOLO detections boost priority: YOLO-backed candidates win conflicts
 *      over color-only candidates in greedy assignment.
 *   4. Greedy global assignment with cell-conflict resolution.
 *   5. Task 4A: Uniqueness constraint — no duplicate classIds.
 *   6. Task 5: Ambiguity gating — configurable policy for uncertain pieces.
 *
 * Color drives the actual cell occupancy and placement fitting, which produces
 * correctly-sized cell sets (4-5 cells per piece). YOLO is a tie-breaker only.
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
import type {
  BoardState,
  Homography,
  PieceMapStats,
  PieceOrientation,
  PiecePlacement,
  UnassignedPiece,
} from "./types";
import type { AmbiguityPlacementPolicy } from "../pipeline/types";

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
  yoloScore: number;
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
  ambiguityPolicy: AmbiguityPlacementPolicy = "off",
): BoardState {
  // Which classes YOLO detected + their best score — used for priority & confidence.
  const yoloScoreByClass = new Map<number, number>();
  for (const det of detections) {
    if (det.classId >= 0 && det.classId < PIECE_CLASS_COUNT && det.score >= YOLO_PIECE_MIN_SCORE) {
      const prev = yoloScoreByClass.get(det.classId) ?? 0;
      if (det.score > prev) yoloScoreByClass.set(det.classId, det.score);
    }
  }

  // White-balance the rectified canvas.
  whiteBalanceRectifiedCanvas(rectifiedCanvas);

  // Color-classify every board cell.
  const colorResult = classifyCellsByColor(rectifiedCanvas);

  // Group cells by piece class (color-driven only).
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
    const yoloScore = yoloScoreByClass.get(classId) ?? 0;
    candidates.push({
      classId,
      placement: fit.placement,
      hitCount: fit.hitCount,
      hitRatio: fit.hitCount / fit.placement.cellSet.size,
      extraCells: fit.extraCells,
      yoloBacked: yoloScore > 0,
      yoloScore,
      sourceCells: colorCells,
    });
  }

  // Sort: YOLO-backed first (higher accuracy), then by hitCount, then fewest extra.
  // Within YOLO-backed, sort by YOLO score (higher = more confident detection).
  candidates.sort((a, b) => {
    if (a.yoloBacked !== b.yoloBacked) return a.yoloBacked ? -1 : 1;
    if (a.yoloBacked && b.yoloBacked) {
      if (b.yoloScore !== a.yoloScore) return b.yoloScore - a.yoloScore;
    }
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return a.extraCells - b.extraCells;
  });

  const occupiedCells = new Set<number>();
  const usedClassIds = new Set<number>();
  const placementsOut: PiecePlacement[] = [];
  const unassignedPieces: UnassignedPiece[] = [];
  let droppedDuplicateCount = 0;

  for (const cand of candidates) {
    // Task 4A: uniqueness
    if (usedClassIds.has(cand.classId)) {
      droppedDuplicateCount++;
      unassignedPieces.push({
        classId: cand.classId,
        className: CLASS_NAMES[cand.classId],
        reason: "duplicate",
      });
      continue;
    }

    // Cell conflict check
    let collides = false;
    for (const cellKey of cand.placement.cellSet) {
      if (occupiedCells.has(cellKey)) { collides = true; break; }
    }
    if (collides) continue;

    // Ambiguity: gap between best and runner-up
    let runnerUpHits = 0;
    for (const pl of getPlacementsByClass(cand.classId)) {
      if (pl === cand.placement) continue;
      if (pl.rotationSteps === cand.placement.rotationSteps && pl.mirrored === cand.placement.mirrored) continue;
      let hits = 0;
      for (const c of pl.cellSet) if (cand.sourceCells.has(c)) hits++;
      if (hits > runnerUpHits) runnerUpHits = hits;
    }
    const ambiguous = cand.hitCount - runnerUpHits < 2;

    // Task 5: Ambiguity gating
    if (ambiguous) {
      if (ambiguityPolicy === "strict") {
        unassignedPieces.push({
          classId: cand.classId,
          className: CLASS_NAMES[cand.classId],
          reason: "ambiguous",
        });
        continue;
      }
      if (ambiguityPolicy === "lenient" && cand.hitRatio < 0.85) {
        unassignedPieces.push({
          classId: cand.classId,
          className: CLASS_NAMES[cand.classId],
          reason: "ambiguous",
        });
        continue;
      }
    }

    for (const cellKey of cand.placement.cellSet) occupiedCells.add(cellKey);
    usedClassIds.add(cand.classId);

    // Confidence: color hit ratio, boosted by YOLO score when available.
    const baseConf = cand.hitRatio;
    const conf = cand.yoloBacked
      ? Math.min(1, baseConf * 0.7 + cand.yoloScore * 0.3)
      : baseConf;

    placementsOut.push({
      classId: cand.classId,
      className: CLASS_NAMES[cand.classId],
      cell: { row: cand.placement.topLeftCell.row, col: cand.placement.topLeftCell.col },
      orientation: rotationToOrientation(cand.placement.rotationSteps),
      mirrored: cand.placement.mirrored,
      confidence: Math.min(1, conf),
      ambiguous,
      source: cand.yoloBacked ? "yolo-mask" : "color-rescue",
      canonicalPositions: [...cand.placement.cellSet],
      canonicalOrientationIndex: cand.placement.orientationIndex,
      placedDespiteAmbiguity: ambiguous ? true : undefined,
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

  const stats: PieceMapStats = {
    maskCount,
    colorRescueCount,
    droppedColorClassIds: [],
    droppedDuplicateCount,
  };

  return { placements: placementsOut, unassignedDetections, unassignedPieces, stats };
}

// ── Debug export ─────────────────────────────────────────────────────────────

export function getColorClassification(
  rectifiedCanvas: HTMLCanvasElement,
): ColorClassificationResult {
  return classifyCellsByColor(rectifiedCanvas);
}

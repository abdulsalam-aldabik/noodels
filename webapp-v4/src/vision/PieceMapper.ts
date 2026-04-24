/**
 * PieceMapper — Per-cell color voting + global greedy assignment.
 *
 * Algorithm:
 *   1. Classify every board cell by color → piece class or empty.
 *   2. For each piece class (0-10), gather ALL cells classified as that class
 *      (ignoring connectivity — handles split/noisy regions).
 *   3. For each piece class with detected cells, scan ALL canonical placements
 *      and count how many placement cells are "hit" by the detected cells.
 *      The placement with the highest hit count wins.
 *   4. Global greedy assignment: process pieces in order of best hit-count,
 *      ensuring no cell is double-assigned.
 */

import { PIECE_CLASS_COUNT, type RawDetection, CLASS_NAMES } from "../inference/types";
import {
  getPlacementsByClass,
  type PinVisitPlacement,
} from "./PinPairIndex";
import type {
  BoardState,
  PieceOrientation,
  PiecePlacement,
} from "./types";
import {
  classifyCellsByColor,
  type ColorClassificationResult,
} from "./ColorCellClassifier";

// ── Types ────────────────────────────────────────────────────────────────────

interface CandidateMatch {
  classId: number;
  placement: PinVisitPlacement;
  /** How many of the placement's cells were detected as this class. */
  hitCount: number;
  /** hitCount / placement.cellSet.size — what fraction of the piece is visible. */
  hitRatio: number;
  /** How many detected cells of this class fall OUTSIDE this placement. */
  extraCells: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rotationToOrientation(steps: 0 | 1 | 2 | 3): PieceOrientation {
  return (steps * 90) as PieceOrientation;
}

// ── Main mapper ──────────────────────────────────────────────────────────────

export function mapPiecesToBoardState(
  rectifiedCanvas: HTMLCanvasElement,
  detections: RawDetection[],
): BoardState {
  // Step 1: Color-classify every cell.
  const colorResult = classifyCellsByColor(rectifiedCanvas);

  // Step 2: Group cells by piece class (ignoring connectivity).
  const cellsByClass = new Map<number, Set<number>>();
  for (const cell of colorResult.cells) {
    if (cell.classId < 0) continue; // skip empty/pin
    let set = cellsByClass.get(cell.classId);
    if (!set) {
      set = new Set<number>();
      cellsByClass.set(cell.classId, set);
    }
    set.add(cell.cellIndex);
  }

  // Step 3: For each piece class, find the best canonical placement.
  const allCandidates: CandidateMatch[] = [];

  for (const [classId, detectedCells] of cellsByClass) {
    if (detectedCells.size < 2) continue; // need at least 2 cells

    const placements = getPlacementsByClass(classId);
    let bestHitCount = 0;
    let bestPlacement: PinVisitPlacement | null = null;
    let bestExtra = Infinity;

    for (const pl of placements) {
      let hits = 0;
      for (const cellKey of pl.cellSet) {
        if (detectedCells.has(cellKey)) hits++;
      }

      if (hits === 0) continue;

      const extra = detectedCells.size - hits;

      if (hits > bestHitCount || (hits === bestHitCount && extra < bestExtra)) {
        bestHitCount = hits;
        bestPlacement = pl;
        bestExtra = extra;
      }
    }

    if (bestPlacement && bestHitCount >= 2) {
      allCandidates.push({
        classId,
        placement: bestPlacement,
        hitCount: bestHitCount,
        hitRatio: bestHitCount / bestPlacement.cellSet.size,
        extraCells: bestExtra,
      });
    }
  }

  // Step 4: Global greedy assignment — most hits first.
  allCandidates.sort((a, b) => {
    if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount;
    return a.extraCells - b.extraCells;
  });

  const occupiedCells = new Set<number>();
  const usedClassIds = new Set<number>();
  const placementsOut: PiecePlacement[] = [];

  for (const cand of allCandidates) {
    if (usedClassIds.has(cand.classId)) continue;

    let collides = false;
    for (const cellKey of cand.placement.cellSet) {
      if (occupiedCells.has(cellKey)) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    for (const cellKey of cand.placement.cellSet) {
      occupiedCells.add(cellKey);
    }
    usedClassIds.add(cand.classId);

    // Ambiguity: check if runner-up orientation scores within 2 hits.
    const detectedCells = cellsByClass.get(cand.classId)!;
    let runnerUpHits = 0;
    const placements = getPlacementsByClass(cand.classId);
    for (const pl of placements) {
      if (pl === cand.placement) continue;
      if (pl.rotationSteps === cand.placement.rotationSteps &&
          pl.mirrored === cand.placement.mirrored) continue;
      let hits = 0;
      for (const cellKey of pl.cellSet) {
        if (detectedCells.has(cellKey)) hits++;
      }
      if (hits > runnerUpHits) runnerUpHits = hits;
    }
    const ambiguous = (cand.hitCount - runnerUpHits) < 2;

    const confidence = Math.min(1, cand.hitRatio);

    placementsOut.push({
      classId: cand.classId,
      className: CLASS_NAMES[cand.classId],
      cell: {
        row: cand.placement.topLeftCell.row,
        col: cand.placement.topLeftCell.col,
      },
      orientation: rotationToOrientation(cand.placement.rotationSteps),
      mirrored: cand.placement.mirrored,
      confidence,
      ambiguous,
      canonicalPositions: [...cand.placement.cellSet],
      canonicalOrientationIndex: cand.placement.orientationIndex,
    });
  }

  // Collect YOLO detections not matched by color classification.
  const unassignedDetections: RawDetection[] = [];
  for (const det of detections) {
    if (det.classId >= 0 && det.classId < PIECE_CLASS_COUNT) {
      if (!usedClassIds.has(det.classId)) {
        unassignedDetections.push(det);
      }
    }
  }

  return {
    placements: placementsOut,
    unassignedDetections,
  };
}

// ── Debug export ─────────────────────────────────────────────────────────────

export function getColorClassification(
  rectifiedCanvas: HTMLCanvasElement,
): ColorClassificationResult {
  return classifyCellsByColor(rectifiedCanvas);
}

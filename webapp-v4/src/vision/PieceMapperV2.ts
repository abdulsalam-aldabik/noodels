/**
 * PieceMapperV2 — CellCoverageMapper.
 *
 * Per-detection pipeline:
 *   1. Warp mask pixels into the 14×14 grid via `frame.homography.forward`.
 *   2. Binarize per-cell coverage → detection cell bitmap.
 *   3. Score against canonical placements for detection.classId using
 *      cell-set IoU.
 *   4. Pick tentative + compute ambiguity against runner-up.
 *   5. Greedy non-overlap resolution ordered by confidence.
 *   6. Degrade ambiguous/confidence when homography condition is poor.
 */

import { CLASS_NAMES, PIECE_CLASS_COUNT } from "../inference/types";
import type { RawDetection } from "../inference/types";
import type {
  BoardState,
  PieceOrientation,
  PiecePlacement,
  RectifiedFrame,
} from "./types";
import {
  cellSetIoU,
  getPlacementIndex,
  type CanonicalPlacement,
} from "./placementIndex";
import { warpMaskToCells } from "./maskToBoardGrid";

export const COVERAGE_THRESHOLD = 0.10;
export const MIN_CELLS = 3;
export const AMBIGUITY_MARGIN = 0.08;
export const MIN_ACCEPT_IOU = 0.2;
export const PIECE_MAPPER_V2_VERSION = "v2.0";

const HOMOGRAPHY_CONDITION_LIMIT = 1e6;

interface ScoredCandidate {
  placement: CanonicalPlacement;
  iou: number;
}

interface DetectionWorkItem {
  originalIndex: number; // index into the ORIGINAL inference.detections array
  detection: RawDetection;
  rowBitmap: Uint16Array;
  totalCells: number;
  candidates: ScoredCandidate[];
}

function rotationToOrientation(steps: 0 | 1 | 2 | 3): PieceOrientation {
  return (steps * 90) as PieceOrientation;
}

export function mapPiecesToBoardStateV2(
  detections: RawDetection[],
  frame: RectifiedFrame,
): BoardState {
  const index = getPlacementIndex();
  const forward = frame.homography.forward;
  const conditionBad = frame.homography.condition > HOMOGRAPHY_CONDITION_LIMIT;

  const unassignedDetections: RawDetection[] = [];
  const workItems: DetectionWorkItem[] = [];

  // First pass: filter piece-class detections, warp, score.
  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    if (det.classId < 0 || det.classId >= PIECE_CLASS_COUNT) {
      // non-piece classes (board/hinge) are ignored by the mapper entirely.
      continue;
    }
    const warp = warpMaskToCells(det, forward, COVERAGE_THRESHOLD);
    if (warp.totalCells < MIN_CELLS) {
      unassignedDetections.push(det);
      continue;
    }
    // Compare mask geometry against EVERY piece class and orientation.
    // This correctly bypasses YOLO's class predictions (which fail on real data)
    // and identifies the piece solely by its physical shape wrapped on the grid.
    const placements: CanonicalPlacement[] = [];
    for (let c = 0; c < PIECE_CLASS_COUNT; c++) {
      placements.push(...(index.get(c) ?? []));
    }

    const scored: ScoredCandidate[] = [];
    for (const pl of placements) {
      const iou = cellSetIoU(warp.rowBitmap, pl.rowBitmap);
      if (iou > 0) scored.push({ placement: pl, iou });
    }
    scored.sort((a, b) => b.iou - a.iou);
    const topCandidates = scored.slice(0, 5);

    if (topCandidates.length === 0 || topCandidates[0].iou < MIN_ACCEPT_IOU) {
      unassignedDetections.push(det);
      continue;
    }

    workItems.push({
      originalIndex: i,
      detection: det,
      rowBitmap: warp.rowBitmap,
      totalCells: warp.totalCells,
      candidates: topCandidates,
    });
  }

  // Deterministic order: by top-1 IoU descending, then by originalIndex asc.
  workItems.sort((a, b) => {
    const d = b.candidates[0].iou - a.candidates[0].iou;
    if (d !== 0) return d;
    return a.originalIndex - b.originalIndex;
  });

  const occupiedCells = new Uint8Array(196);
  const placementsOut: PiecePlacement[] = [];

  for (const item of workItems) {
    // Find the first candidate whose cell set is disjoint from occupiedCells.
    let chosenIdx = -1;
    for (let c = 0; c < item.candidates.length; c++) {
      const cand = item.candidates[c];
      let collides = false;
      for (const key of cand.placement.cellSet) {
        if (occupiedCells[key] === 1) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        chosenIdx = c;
        break;
      }
    }

    if (chosenIdx === -1) {
      unassignedDetections.push(item.detection);
      continue;
    }

    const chosen = item.candidates[chosenIdx];
    // Only the first-ranked candidate is the "tentative" pick for ambiguity
    // margin; fall-through still accepts but uses the chosen one's margin vs
    // its immediate runner-up.
    const runnerUp = item.candidates[chosenIdx + 1];
    const margin = chosen.iou - (runnerUp?.iou ?? 0);
    let ambiguous =
      margin < AMBIGUITY_MARGIN || chosen.iou < MIN_ACCEPT_IOU;

    let confidence = chosen.iou;

    if (conditionBad) {
      ambiguous = true;
      if (confidence > 0.5) confidence = 0.5;
    }

    // Mark cells as occupied.
    for (const key of chosen.placement.cellSet) {
      occupiedCells[key] = 1;
    }

    const topK = item.candidates.slice(0, 3).map((c) => ({
      orientation: rotationToOrientation(c.placement.rotationSteps),
      mirrored: c.placement.mirrored,
      score: c.iou,
    }));

    const placement: PiecePlacement = {
      classId: chosen.placement.classId,
      className: CLASS_NAMES[chosen.placement.classId],
      cell: {
        row: chosen.placement.topLeftCell.row,
        col: chosen.placement.topLeftCell.col,
      },
      orientation: rotationToOrientation(chosen.placement.rotationSteps),
      mirrored: chosen.placement.mirrored,
      confidence,
      ambiguous,
      topK,
      sourceDetectionIndex: item.originalIndex,
    };
    placementsOut.push(placement);
  }

  // Deterministic output order: by sourceDetectionIndex ascending.
  placementsOut.sort((a, b) => a.sourceDetectionIndex - b.sourceDetectionIndex);

  return {
    placements: placementsOut,
    unassignedDetections,
  };
}

/**
 * PieceMapperV3 — Hybrid Pin + Cell-Coverage Mapper.
 *
 * Combines the strengths of the pins path (positional constraint via visited
 * pin sets) with the V2 path (shape constraint via cell-set IoU), plus a
 * YOLO class hint for tie-breaking.
 *
 * Per-detection pipeline:
 *   1. Compute visited pins via improved PinSnapper (annular ring probe).
 *   2. Warp mask pixels into 14×14 grid → cell coverage bitmap.
 *   3. Score against ALL canonical placements across ALL piece classes:
 *        combinedScore = W_PIN × pinJaccard + W_CELL × cellIoU + W_CLASS × classBonus
 *   4. Class-agnostic: YOLO's class prediction is a hint (classBonus), not a filter.
 *   5. Global greedy assignment ordered by combinedScore descending:
 *      - Each classId can only be placed once.
 *      - No two placements may share any board cells.
 *
 * This solves the problems in the V2 and pins paths:
 *   - V2 had no pin constraint → ambiguous shape matches.
 *   - Pins path trusted YOLO class blindly and had no shape-based disambiguation.
 *   - Neither resolved mirror/rotation ambiguity using the actual mask.
 */

import { PIECE_CLASS_COUNT, type RawDetection } from "../inference/types";
import { computePinBoardPoints, type PinBoardPoint } from "../board/gridGeometry";
import { warpMaskToCells } from "./maskToBoardGrid";
import { cellSetIoU } from "./placementIndex";
import {
  getPlacementsByClass,
  pinSetJaccard,
  type PinVisitPlacement,
} from "./PinPairIndex";
import type {
  BoardState,
  PieceOrientation,
  PiecePlacement,
  RectifiedFrame,
} from "./types";
import { CLASS_NAMES } from "../inference/types";
import { findVisitedPinsByProbeWithCoverage, type PinVisitWithCoverage } from "./PinSnapper";
import { extractPieceEndpoints } from "./PieceEndpointExtractor";

// ── Scoring weights ──────────────────────────────────────────────────────────

/** Weight for pin-set Jaccard similarity (positional constraint). */
const W_PIN = 0.35;
/** Weight for cell-set IoU (shape constraint, most discriminative). */
const W_CELL = 0.50;
/** Weight for YOLO class match bonus (tie-breaker, not a filter). */
const W_CLASS = 0.15;

/** Minimum combined score to accept a placement. */
const MIN_COMBINED_SCORE = 0.15;
/** Minimum cell IoU alone to consider a candidate (skip obvious non-matches). */
const MIN_CELL_IOU = 0.10;
/** Minimum pin Jaccard alone to consider a candidate. */
const MIN_PIN_JACCARD = 0.0; // allow pure shape matches when pins are missed
/** Maximum candidates to evaluate per detection (perf bound). */
const MAX_CANDIDATES_PER_DETECTION = 30;
/** Coverage threshold for warping mask to cell grid. */
const COVERAGE_THRESHOLD = 0.10;
/** Minimum cells in warped mask to proceed. */
const MIN_CELLS = 3;

export const PIECE_MAPPER_V3_VERSION = "v3.0";

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  placement: PinVisitPlacement;
  pinJaccard: number;
  cellIoU: number;
  classBonus: number;
  combinedScore: number;
}

interface DetectionWorkItem {
  originalIndex: number;
  detection: RawDetection;
  visitedPins: number[];
  pinCoverages: PinVisitWithCoverage[];
  rowBitmap: Uint16Array;
  totalCells: number;
  candidates: ScoredCandidate[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rotationToOrientation(steps: 0 | 1 | 2 | 3): PieceOrientation {
  return (steps * 90) as PieceOrientation;
}

/**
 * For each detection, find visited pins via probe (when boardToImg is
 * available and mask exists) or fall back to the sample-scan path.
 */
function computeVisitedPins(
  detection: RawDetection,
  imgToBoard: number[],
  boardToImg: number[],
  canonical: PinBoardPoint[],
): { visitedPins: number[]; pinCoverages: PinVisitWithCoverage[] } {
  if (detection.mask && boardToImg) {
    const coverages = findVisitedPinsByProbeWithCoverage(
      detection,
      canonical,
      boardToImg,
    );
    return {
      visitedPins: coverages.map((v) => v.pinIndex),
      pinCoverages: coverages,
    };
  }
  // Fallback: use PCA board samples for pin proximity
  const extracted = extractPieceEndpoints(detection, imgToBoard);
  const visitedPins: number[] = [];
  const coverages: PinVisitWithCoverage[] = [];
  const RADIUS = 0.65;
  const r2 = RADIUS * RADIUS;
  for (const cp of canonical) {
    for (const s of extracted.boardSamples) {
      const dx = s.x - cp.x;
      const dy = s.y - cp.y;
      if (dx * dx + dy * dy <= r2) {
        visitedPins.push(cp.pinIndex);
        coverages.push({ pinIndex: cp.pinIndex, coverage: 0.5 });
        break;
      }
    }
  }
  return { visitedPins, pinCoverages: coverages };
}

// ── Main mapper ──────────────────────────────────────────────────────────────

export function mapPiecesToBoardStateV3(
  detections: RawDetection[],
  frame: RectifiedFrame,
): BoardState {
  const forward = frame.homography.forward;
  const inverse = frame.homography.inverse;
  const canonical = computePinBoardPoints();

  const unassignedDetections: RawDetection[] = [];
  const workItems: DetectionWorkItem[] = [];

  // ── Phase 1: Per-detection scoring ───────────────────────────────────────

  for (let i = 0; i < detections.length; i++) {
    const det = detections[i];
    // Skip non-piece classes.
    if (det.classId < 0 || det.classId >= PIECE_CLASS_COUNT) continue;

    // Step 1: Warp mask to cell grid.
    const warp = warpMaskToCells(det, forward, COVERAGE_THRESHOLD);
    if (warp.totalCells < MIN_CELLS) {
      unassignedDetections.push(det);
      continue;
    }

    // Step 2: Compute visited pins.
    const { visitedPins, pinCoverages } = computeVisitedPins(
      det,
      forward,
      inverse,
      canonical,
    );

    // Step 3: Score against ALL canonical placements across ALL piece classes.
    const scored: ScoredCandidate[] = [];

    for (let classId = 0; classId < PIECE_CLASS_COUNT; classId++) {
      const placements = getPlacementsByClass(classId);
      for (const pl of placements) {
        // Cell IoU (shape match).
        const ciou = cellSetIoU(warp.rowBitmap, pl.rowBitmap);
        if (ciou < MIN_CELL_IOU) continue;

        // Pin Jaccard (positional match).
        const pj = visitedPins.length > 0
          ? pinSetJaccard(visitedPins, pl.pinsVisited)
          : 0;
        if (pj < MIN_PIN_JACCARD) continue;

        // Class bonus: 1.0 if YOLO agrees, 0.0 otherwise.
        const classBonus = classId === det.classId ? 1.0 : 0.0;

        // Combined score.
        const combinedScore = W_PIN * pj + W_CELL * ciou + W_CLASS * classBonus;

        if (combinedScore >= MIN_COMBINED_SCORE) {
          scored.push({
            placement: pl,
            pinJaccard: pj,
            cellIoU: ciou,
            classBonus,
            combinedScore,
          });
        }
      }
    }

    // Sort by combined score descending.
    scored.sort((a, b) => b.combinedScore - a.combinedScore);
    const topCandidates = scored.slice(0, MAX_CANDIDATES_PER_DETECTION);

    if (topCandidates.length === 0) {
      unassignedDetections.push(det);
      continue;
    }

    workItems.push({
      originalIndex: i,
      detection: det,
      visitedPins,
      pinCoverages,
      rowBitmap: warp.rowBitmap,
      totalCells: warp.totalCells,
      candidates: topCandidates,
    });
  }

  // ── Phase 2: Global greedy assignment ────────────────────────────────────
  // Sort work items by their best candidate's combined score descending.
  // This ensures high-confidence detections claim their spots first.
  workItems.sort((a, b) => {
    const d = b.candidates[0].combinedScore - a.candidates[0].combinedScore;
    if (d !== 0) return d;
    return a.originalIndex - b.originalIndex;
  });

  const occupiedCells = new Uint8Array(196); // 14×14 = 196
  const usedClassIds = new Set<number>();
  const placementsOut: PiecePlacement[] = [];

  for (const item of workItems) {
    // Find the best candidate that doesn't collide with already-placed pieces
    // and whose class hasn't already been used.
    let chosenIdx = -1;

    for (let c = 0; c < item.candidates.length; c++) {
      const cand = item.candidates[c];

      // Constraint: each piece class can only be placed once.
      if (usedClassIds.has(cand.placement.classId)) continue;

      // Constraint: no cell overlaps.
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

    // Ambiguity: check if a runner-up from a DIFFERENT orientation of the
    // SAME class scores close. This is the mirror/rotation ambiguity case.
    const runnerUp = item.candidates.find(
      (c, idx) =>
        idx > chosenIdx &&
        c.placement.classId === chosen.placement.classId &&
        !usedClassIds.has(c.placement.classId) &&
        (c.placement.rotationSteps !== chosen.placement.rotationSteps ||
          c.placement.mirrored !== chosen.placement.mirrored),
    );
    const margin = chosen.combinedScore - (runnerUp?.combinedScore ?? 0);
    const ambiguous = margin < 0.08;

    // Mark cells as occupied and class as used.
    for (const key of chosen.placement.cellSet) {
      occupiedCells[key] = 1;
    }
    usedClassIds.add(chosen.placement.classId);

    // Build topK for telemetry.
    const topK = item.candidates
      .filter((c) => c.placement.classId === chosen.placement.classId)
      .slice(0, 3)
      .map((c) => ({
        orientation: rotationToOrientation(c.placement.rotationSteps),
        mirrored: c.placement.mirrored,
        score: c.combinedScore,
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
      confidence: chosen.combinedScore,
      ambiguous,
      topK,
      sourceDetectionIndex: item.originalIndex,
    };
    placementsOut.push(placement);
  }

  // Stable output order by sourceDetectionIndex.
  placementsOut.sort((a, b) => a.sourceDetectionIndex - b.sourceDetectionIndex);

  return {
    placements: placementsOut,
    unassignedDetections,
  };
}

/**
 * Resolve a PinEndpointAssignment into a canonical PiecePlacement via
 * PinPairIndex.findPlacementsByPinSet.
 *
 * If the detected visited-pin set exactly matches a legal canonical
 * placement, we emit it with full confidence (0.95). When multiple canonical
 * placements (mirrors, rotations) share the same visited-pin set the result
 * is flagged `ambiguous: true` and populates `topK` with each candidate. The
 * ScanPipeline / orientation-refinement stage is expected to resolve the
 * mirror axis downstream.
 *
 * Detections whose visited-pin set is not in the legal index are dropped —
 * callers receive them via {@link assignmentsToBoardState}'s
 * `unassignedDetections` list for telemetry / fallback display.
 */

import type { RawDetection } from "../inference/types";
import type {
  BoardState,
  PieceOrientation,
  PiecePlacement,
  PinEndpointAssignment,
} from "./types";
import { findPlacementsByPinSet, type PinVisitPlacement } from "./PinPairIndex";

const EXACT_MATCH_CONFIDENCE = 0.95;
const AMBIGUOUS_PRIMARY_CONFIDENCE = 0.55;

export interface ResolveOptions {
  /** Optional per-class disambiguation callback run when multiple matches tie. */
  disambiguator?: (
    candidates: PinVisitPlacement[],
    assignment: PinEndpointAssignment,
  ) => PinVisitPlacement;
}

export function resolveAssignmentToPlacement(
  assignment: PinEndpointAssignment,
  options: ResolveOptions = {},
): PiecePlacement | null {
  if (assignment.visitedPins.length < 2) return null;
  const candidates = findPlacementsByPinSet(assignment.classId, assignment.visitedPins);
  if (candidates.length === 0) return null;

  const ambiguous = candidates.length > 1;
  const primary = ambiguous && options.disambiguator
    ? options.disambiguator(candidates, assignment)
    : candidates[0];

  const topK = candidates.map((c) => ({
    orientation: rotationStepsToOrientation(c.rotationSteps),
    mirrored: c.mirrored,
    score:
      c === primary ? EXACT_MATCH_CONFIDENCE : AMBIGUOUS_PRIMARY_CONFIDENCE,
  }));

  return {
    classId: assignment.classId,
    className: assignment.className,
    cell: { row: primary.topLeftCell.row, col: primary.topLeftCell.col },
    orientation: rotationStepsToOrientation(primary.rotationSteps),
    mirrored: primary.mirrored,
    confidence: ambiguous ? AMBIGUOUS_PRIMARY_CONFIDENCE : EXACT_MATCH_CONFIDENCE,
    ambiguous,
    topK,
    sourceDetectionIndex: assignment.sourceDetectionIndex,
  };
}

/**
 * Convenience: drive resolve for every assignment and shape the output as a
 * BoardState. Detections without a legal pin set are collected into
 * `unassignedDetections` alongside their original RawDetection.
 */
export function assignmentsToBoardState(
  assignments: PinEndpointAssignment[],
  allDetections: RawDetection[],
  options: ResolveOptions = {},
): BoardState {
  const placements: PiecePlacement[] = [];
  const unassignedIndices = new Set<number>();

  for (const a of assignments) {
    const placement = resolveAssignmentToPlacement(a, options);
    if (placement) placements.push(placement);
    else unassignedIndices.add(a.sourceDetectionIndex);
  }

  // Dedupe: if two detections claim the same (classId, cellSet) placement,
  // keep the higher-confidence one (ambiguity-aware: non-ambiguous beats ambiguous,
  // then higher confidence wins). This handles duplicate detections of the same piece.
  const byKey = new Map<string, PiecePlacement>();
  for (const p of placements) {
    const key = `${p.classId}:${p.cell.row},${p.cell.col}:${p.orientation}:${p.mirrored}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
      continue;
    }
    const betterAmbig = !p.ambiguous && existing.ambiguous;
    const sameAmbigHigher = p.ambiguous === existing.ambiguous && p.confidence > existing.confidence;
    if (betterAmbig || sameAmbigHigher) {
      unassignedIndices.add(existing.sourceDetectionIndex);
      byKey.set(key, p);
    } else {
      unassignedIndices.add(p.sourceDetectionIndex);
    }
  }

  const deduped = [...byKey.values()];
  const unassignedDetections = [...unassignedIndices]
    .map((i) => allDetections[i])
    .filter((d): d is RawDetection => d !== undefined);

  return {
    placements: deduped,
    unassignedDetections,
  };
}

function rotationStepsToOrientation(steps: 0 | 1 | 2 | 3): PieceOrientation {
  return ([0, 90, 180, 270] as const)[steps];
}

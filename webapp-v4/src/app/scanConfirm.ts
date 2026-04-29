import { BOARD_WIDTH } from "../engine/constants";
import { generatePlacementsForPiece } from "../engine/placements";
import type { PiecePlacement as EnginePlacement } from "../engine/types";
import type { ScanResult } from "../pipeline/types";

export const DEFAULT_SCAN_CONFIDENCE_THRESHOLD = 0.15;

export function resolveToEnginePlacement(
  classId: number,
  cell: { row: number; col: number },
  orientationDeg: number,
  mirrored: boolean,
  canonicalPositions?: number[],
  canonicalOrientationIndex?: number,
): EnginePlacement | null {
  const allPlacements = generatePlacementsForPiece(classId);
  const rotationSteps = orientationDeg / 90;

  if (canonicalPositions && canonicalPositions.length > 0) {
    const posSet = new Set(canonicalPositions);

    for (const p of allPlacements) {
      if (p.positions.length !== posSet.size) continue;
      if (p.positions.every((pos) => posSet.has(pos))) {
        return p;
      }
    }

    if (canonicalOrientationIndex !== undefined) {
      for (const p of allPlacements) {
        if (
          p.orientationIndex === canonicalOrientationIndex &&
          (p.rotationSteps ?? 0) === rotationSteps &&
          (p.mirrored ?? false) === mirrored
        ) {
          if (p.positions.some((pos) => posSet.has(pos))) {
            return p;
          }
        }
      }
    }
  }

  const targetPos = cell.row * BOARD_WIDTH + cell.col;

  for (const p of allPlacements) {
    if (
      (p.rotationSteps ?? 0) === rotationSteps &&
      (p.mirrored ?? false) === mirrored &&
      p.positions.includes(targetPos)
    ) {
      return p;
    }
  }

  const covering = allPlacements.filter((p) => p.positions.includes(targetPos));
  if (covering.length === 0) return null;

  let best = covering[0];
  let bestDist = Infinity;
  for (const p of covering) {
    let sumRow = 0;
    let sumCol = 0;
    for (const pos of p.positions) {
      sumRow += Math.floor(pos / BOARD_WIDTH);
      sumCol += pos % BOARD_WIDTH;
    }
    const avgRow = sumRow / p.positions.length;
    const avgCol = sumCol / p.positions.length;
    const dr = avgRow - cell.row;
    const dc = avgCol - cell.col;
    const dist = dr * dr + dc * dc;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  return best;
}

export function buildConfirmedPlacements(
  scanResult: ScanResult,
  confidenceThreshold: number = DEFAULT_SCAN_CONFIDENCE_THRESHOLD,
): Map<number, EnginePlacement> {
  const confirmed = new Map<number, EnginePlacement>();
  if (scanResult.status === "failed" || !scanResult.boardState) return confirmed;

  for (const placement of scanResult.boardState.placements) {
    if (placement.confidence < confidenceThreshold) continue;
    const engine = resolveToEnginePlacement(
      placement.classId,
      placement.cell,
      placement.orientation,
      placement.mirrored,
      placement.canonicalPositions,
      placement.canonicalOrientationIndex,
    );
    if (engine) confirmed.set(placement.classId, engine);
  }
  return confirmed;
}

export function countConfirmable(
  scanResult: ScanResult | null,
  confidenceThreshold: number = DEFAULT_SCAN_CONFIDENCE_THRESHOLD,
): number {
  if (!scanResult || scanResult.status === "failed" || !scanResult.boardState) return 0;
  return scanResult.boardState.placements.filter((p) => p.confidence >= confidenceThreshold).length;
}

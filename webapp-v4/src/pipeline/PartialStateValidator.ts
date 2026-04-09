import { validate } from "../engine/solver";
import type { PiecePlacement } from "../engine/types";
import type { MappedPiecePlacement, ValidationReport } from "../vision/visionTypes";

const VALIDATE_TIMEOUT_MS = 1800;

function intersectPositions(a: number[], b: number[]): number[] {
  const lookup = new Set(a);
  const shared: number[] = [];
  for (const pos of b) {
    if (lookup.has(pos)) shared.push(pos);
  }
  return shared;
}

/**
 * Validates an already-assigned partial state.
 * Placement selection is handled by PieceAssigner.
 */
export function validatePartialState(
  mappedPlacements: MappedPiecePlacement[],
  confirmedPlacements: Map<number, PiecePlacement>,
): { report: ValidationReport; confirmedPlacements: Map<number, PiecePlacement> } {
  const warnings: string[] = [];
  const mappedById = new Map<number, MappedPiecePlacement>(
    mappedPlacements.map((m) => [m.classId, m]),
  );

  const droppedPieces = mappedPlacements
    .filter((m) => !confirmedPlacements.has(m.classId))
    .map((m) => m.classId);

  for (const pieceId of droppedPieces) {
    const info = mappedById.get(pieceId);
    if (info) {
      warnings.push(`Piece ${info.pieceKey}: dropped by global assignment or low confidence candidate set.`);
    }
  }

  const conflicts: ValidationReport["conflicts"] = [];
  const conflictKeys = new Set<string>();

  const entries = [...confirmedPlacements.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [pieceA, placementA] = entries[i];
      const [pieceB, placementB] = entries[j];
      const shared = intersectPositions(placementA.positions, placementB.positions);
      if (shared.length === 0) continue;

      const key = `${pieceA}-${pieceB}`;
      if (conflictKeys.has(key)) continue;
      conflictKeys.add(key);
      conflicts.push({ pieceA, pieceB, sharedCells: shared });
    }
  }

  // Compute occupied cells summary for validation notes.
  const occupiedCells = new Set<number>();
  for (const placement of confirmedPlacements.values()) {
    for (const pos of placement.positions) {
      occupiedCells.add(pos);
    }
  }

  if (occupiedCells.size === 0) {
    warnings.push("No piece placements were confirmed for this scan.");
  }

  // Solver check for downstream hint reliability.

  let solvable: boolean | null = null;
  if (confirmedPlacements.size > 0) {
    const validationResult = validate(confirmedPlacements, VALIDATE_TIMEOUT_MS);
    if (!validationResult.placementsValid) {
      warnings.push("Engine found placement conflicts — state may be inconsistent");
    }
    solvable = validationResult.solvable;
  }

  const valid = conflicts.length === 0 && droppedPieces.length === 0;

  return {
    report: { valid, conflicts, droppedPieces, solvable, warnings },
    confirmedPlacements,
  };
}

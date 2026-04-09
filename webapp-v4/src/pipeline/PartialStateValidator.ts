import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";
import { generatePlacementsForPiece } from "../engine/placements";
import { validate } from "../engine/solver";
import type { PiecePlacement } from "../engine/types";
import { MIN_CELL_CONFIDENCE } from "../inference/inferenceTypes";
import type { MappedPiecePlacement, ValidationReport } from "../vision/visionTypes";

const BOARD_CELLS = BOARD_WIDTH * BOARD_HEIGHT;

/**
 * Converts a MappedPiecePlacement's candidateCell to a solver-ready PiecePlacement
 * by selecting the valid placement from generatePlacementsForPiece() whose positions
 * contain the candidate cell and whose centroid is geometrically closest to the
 * detected board centroid.
 *
 * Returns null if no valid placement covers the candidate cell.
 */
function resolveToEnginePlacement(mapped: MappedPiecePlacement): PiecePlacement | null {
  const [targetRow, targetCol] = mapped.candidateCell;
  const targetPos = targetRow * BOARD_WIDTH + targetCol;

  const allPlacements = generatePlacementsForPiece(mapped.classId);

  // Filter to placements that include the candidate cell
  const covering = allPlacements.filter((p) => p.positions.includes(targetPos));
  if (covering.length === 0) return null;

  // Rank by how close the placement's geometric centroid is to the detected board centroid
  const [detectedCol, detectedRow] = mapped.boardCentroid;

  let best: PiecePlacement = covering[0];
  let bestDist = Infinity;

  for (const placement of covering) {
    // Compute placement centroid in grid space
    let sumRow = 0, sumCol = 0;
    for (const pos of placement.positions) {
      sumRow += Math.floor(pos / BOARD_WIDTH);
      sumCol += pos % BOARD_WIDTH;
    }
    const avgRow = sumRow / placement.positions.length;
    const avgCol = sumCol / placement.positions.length;

    const dr = avgRow - detectedRow;
    const dc = avgCol - detectedCol;
    const dist = dr * dr + dc * dc;

    if (dist < bestDist) {
      bestDist = dist;
      best = placement;
    }
  }

  return best;
}

/**
 * Validates the mapped piece placements:
 * 1. Drops pieces below MIN_CELL_CONFIDENCE
 * 2. Resolves each mapped cell to an engine PiecePlacement
 * 3. Detects cell conflicts between pieces
 * 4. Calls the engine's validate() to check solvability
 *
 * Returns a ValidationReport and the confirmed Map<pieceId, PiecePlacement>
 * ready to hand to the solver.
 */
export function validatePartialState(
  mappedPlacements: MappedPiecePlacement[],
): { report: ValidationReport; confirmedPlacements: Map<number, PiecePlacement> } {
  const warnings: string[] = [];
  const droppedPieces: number[] = [];
  const confirmed = new Map<number, PiecePlacement>();

  // ── 1. Drop low-confidence mappings ──────────────────────────────────────

  for (const m of mappedPlacements) {
    if (m.cellConfidence < MIN_CELL_CONFIDENCE) {
      droppedPieces.push(m.classId);
      warnings.push(`Piece ${m.pieceKey}: dropped (cellConfidence=${m.cellConfidence.toFixed(2)} < ${MIN_CELL_CONFIDENCE})`);
      continue;
    }

    const placement = resolveToEnginePlacement(m);
    if (!placement) {
      droppedPieces.push(m.classId);
      warnings.push(`Piece ${m.pieceKey}: no valid engine placement covers cell [${m.candidateCell}]`);
      continue;
    }

    confirmed.set(m.classId, placement);
  }

  // ── 2. Detect cell conflicts ──────────────────────────────────────────────

  const conflicts: ValidationReport["conflicts"] = [];
  const cellOwner = new Array<number | null>(BOARD_CELLS).fill(null);

  for (const [pieceId, placement] of confirmed) {
    const conflicting: number[] = [];
    for (const pos of placement.positions) {
      const owner = cellOwner[pos];
      if (owner !== null) {
        conflicting.push(pos);
      }
    }

    if (conflicting.length > 0) {
      // Find which piece owns these cells and register conflict
      const ownerIds = new Set(conflicting.map((pos) => cellOwner[pos]!));
      for (const ownerId of ownerIds) {
        conflicts.push({ pieceA: ownerId, pieceB: pieceId, sharedCells: conflicting });
      }

      // Drop the new piece (the earlier-processed one keeps its cells)
      droppedPieces.push(pieceId);
      confirmed.delete(pieceId);
      warnings.push(
        `Piece ${pieceId}: dropped due to conflict with piece(s) ${[...ownerIds].join(", ")}`,
      );
      continue;
    }

    // Mark cells as owned
    for (const pos of placement.positions) {
      cellOwner[pos] = pieceId;
    }
  }

  // ── 3. Engine solvability check ───────────────────────────────────────────

  let solvable: boolean | null = null;
  if (confirmed.size > 0) {
    const validationResult = validate(confirmed, 2000);
    if (!validationResult.placementsValid) {
      // Engine found internal conflicts (shouldn't happen after our check, but defensive)
      warnings.push("Engine found placement conflicts — state may be inconsistent");
    }
    solvable = validationResult.solvable;
  }

  const valid = conflicts.length === 0 && droppedPieces.length === 0;

  return {
    report: { valid, conflicts, droppedPieces, solvable, warnings },
    confirmedPlacements: confirmed,
  };
}

import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";
import { validate } from "../engine/solver";
import type { PiecePlacement } from "../engine/types";
import type { MappedPiecePlacement, ValidationReport } from "../vision/visionTypes";

const BOARD_CELLS = BOARD_WIDTH * BOARD_HEIGHT;

/**
 * Validation-only stage. Does NOT pick or rank placements — that work has
 * already been done by the candidate generator and global assigner. This
 * function only:
 *
 *   1. Checks for cell-level overlaps in the resolved placements
 *      (defensive — globalAssign should have prevented these).
 *   2. Asks the engine whether the resulting partial state is solvable.
 *   3. Records which mapped pieces did NOT make it into the final
 *      assignment (so the user knows which detections were dropped).
 *
 * Pieces with conflicts are dropped from the returned `confirmedPlacements`,
 * but the input `resolvedPlacements` map is not mutated.
 */
interface ConflictCheckState {
  confirmed: Map<number, PiecePlacement>;
  cellOwner: Array<number | null>;
  conflicts: ValidationReport["conflicts"];
  droppedPieces: number[];
  warnings: string[];
}

/** Tries to register a single piece, recording conflicts and updating state. */
function tryRegisterPiece(
  pieceId: number,
  placement: PiecePlacement,
  state: ConflictCheckState,
): void {
  const conflicting: number[] = [];
  for (const pos of placement.positions) {
    if (state.cellOwner[pos] !== null) conflicting.push(pos);
  }

  if (conflicting.length > 0) {
    const ownerIds = new Set(conflicting.map((pos) => state.cellOwner[pos]!));
    for (const ownerId of ownerIds) {
      state.conflicts.push({ pieceA: ownerId, pieceB: pieceId, sharedCells: conflicting });
    }
    state.droppedPieces.push(pieceId);
    state.warnings.push(
      `Piece ${pieceId}: dropped due to conflict with piece(s) ${[...ownerIds].join(", ")}`,
    );
    return;
  }

  state.confirmed.set(pieceId, placement);
  for (const pos of placement.positions) state.cellOwner[pos] = pieceId;
}

/** Records mapped pieces that were detected but never made it to the final assignment. */
function recordUnassignedMappings(
  mappedPlacements: MappedPiecePlacement[],
  state: ConflictCheckState,
): void {
  for (const mp of mappedPlacements) {
    if (state.confirmed.has(mp.classId)) continue;
    if (state.droppedPieces.includes(mp.classId)) continue;
    state.droppedPieces.push(mp.classId);
    state.warnings.push(
      `Piece ${mp.pieceKey}: detected but no candidate survived global assignment`,
    );
  }
}

export function validatePartialState(
  resolvedPlacements: Map<number, PiecePlacement>,
  mappedPlacements: MappedPiecePlacement[],
): { report: ValidationReport; confirmedPlacements: Map<number, PiecePlacement> } {
  const state: ConflictCheckState = {
    confirmed: new Map(),
    cellOwner: new Array<number | null>(BOARD_CELLS).fill(null),
    conflicts: [],
    droppedPieces: [],
    warnings: [],
  };

  for (const [pieceId, placement] of resolvedPlacements) {
    tryRegisterPiece(pieceId, placement, state);
  }

  recordUnassignedMappings(mappedPlacements, state);

  let solvable: boolean | null = null;
  if (state.confirmed.size > 0) {
    const validationResult = validate(state.confirmed, 2000);
    if (!validationResult.placementsValid) {
      state.warnings.push("Engine found placement conflicts — state may be inconsistent");
    }
    solvable = validationResult.solvable;
  }

  const valid = state.conflicts.length === 0 && state.droppedPieces.length === 0;

  return {
    report: {
      valid,
      conflicts: state.conflicts,
      droppedPieces: state.droppedPieces,
      solvable,
      warnings: state.warnings,
    },
    confirmedPlacements: state.confirmed,
  };
}

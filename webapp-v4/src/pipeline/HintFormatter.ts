import { getHint } from "../engine/solver";
import type { NoodlesSolverResult } from "../engine/solver";
import type { PiecePlacement } from "../engine/types";
import { generatePlacementsForPiece } from "../engine/placements";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import type { HintPayload } from "../vision/visionTypes";

/**
 * Maps a solver's statesExplored count to a 3-tier confidence label.
 * Fewer states = tighter constraint = more confident hint.
 */
function solverConfidence(result: NoodlesSolverResult): HintPayload["hintConfidence"] {
  if (result.timedOut || result.statesExplored > 50_000) return "low";
  if (result.statesExplored > 1_000) return "medium";
  return "high";
}

/**
 * Runs the solver from the given partial state and formats a HintPayload.
 *
 * Returns null if the solver cannot find a solution (board state is invalid/unsolvable).
 */
export function formatHint(confirmedPlacements: Map<number, PiecePlacement>): {
  hint: HintPayload | null;
  solverResult: NoodlesSolverResult | null;
} {
  const hintResult = getHint(confirmedPlacements.size > 0 ? confirmedPlacements : undefined);

  if (!hintResult) {
    // Solver found no solution — state is unsolvable or all pieces are placed
    return { hint: null, solverResult: null };
  }

  const { pieceId, placement, fullResult } = hintResult;

  // Count alternative placements for this piece in the solution context
  const allForPiece = generatePlacementsForPiece(pieceId);
  // Alternatives = all free placements minus the hinted one
  const placedCells = new Set<number>();
  for (const p of confirmedPlacements.values()) {
    for (const pos of p.positions) placedCells.add(pos);
  }
  const freePlacements = allForPiece.filter(
    (p) => p.positions.every((pos) => !placedCells.has(pos)),
  );

  const asset = PIECE_ASSET_BY_ID[pieceId];

  const hint: HintPayload = {
    nextPieceId: pieceId,
    nextPieceKey: asset?.key ?? `piece_${pieceId}`,
    placement,
    hintConfidence: solverConfidence(fullResult),
    alternativePlacements: Math.max(0, freePlacements.length - 1),
    solverTimeMs: fullResult.timeMs,
    statesExplored: fullResult.statesExplored,
  };

  return { hint, solverResult: fullResult };
}

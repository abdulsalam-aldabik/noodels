import { useState } from "react";
import { solve, validate, getHint } from "../engine/solver";
import type { PiecePlacement } from "../engine/types";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";

/**
 * Provides solve, validate, and hint actions with async status feedback.
 *
 * Each action runs after a short setTimeout to allow React to flush the
 * "Solving..." status message to the DOM before the synchronous solver blocks.
 */
export function useSolver(
  getInitialPlacements: () => Map<number, PiecePlacement>,
  onSolutionApplied: (placements: Record<number, PiecePlacement>) => void,
  onHintApplied: (pieceId: number, placement: PiecePlacement) => void,
) {
  const [solverStatus, setSolverStatus] = useState("");

  function clearStatus(): void {
    setSolverStatus("");
  }

  function onSolve(): void {
    setSolverStatus("Solving...");
    setTimeout(() => {
      const result = solve(getInitialPlacements());
      if (result.solved) {
        const next: Record<number, PiecePlacement> = {};
        result.solution.forEach((placement, pieceId) => {
          if (placement) next[pieceId] = placement;
        });
        onSolutionApplied(next);
        setSolverStatus(`Solved in ${result.timeMs.toFixed(0)}ms (${result.statesExplored} states)`);
      } else if (result.timedOut) {
        setSolverStatus("Solver timed out");
      } else {
        setSolverStatus("No solution found");
      }
    }, 10);
  }

  function onValidate(): void {
    const placements = getInitialPlacements();
    if (placements.size === 0) {
      setSolverStatus("Place some pieces first");
      return;
    }
    setSolverStatus("Validating...");
    setTimeout(() => {
      const result = validate(placements, 2000);
      if (!result.placementsValid) {
        setSolverStatus("Invalid: pieces overlap");
      } else if (result.solvable === true) {
        setSolverStatus(`Valid — solution exists (${result.timeMs.toFixed(0)}ms)`);
      } else if (result.solvable === false) {
        setSolverStatus("Dead end — no solution from here");
      } else {
        setSolverStatus("Valid placement (solver timed out, can't confirm)");
      }
    }, 10);
  }

  function onHint(): void {
    setSolverStatus("Finding hint...");
    setTimeout(() => {
      const hint = getHint(getInitialPlacements());
      if (hint) {
        onHintApplied(hint.pieceId, hint.placement);
        setSolverStatus(`Hint: piece ${PIECE_ASSET_BY_ID[hint.pieceId].key} (${hint.fullResult.timeMs.toFixed(0)}ms)`);
      } else {
        setSolverStatus("No hint available");
      }
    }, 10);
  }

  return { solverStatus, clearStatus, onSolve, onValidate, onHint };
}

import { useCallback, useMemo } from "react";
import { IQ_NOODLES_PIECES } from "../engine/constants";
import { generatePlacementsForPiece } from "../engine/placements";
import type { PiecePlacement } from "../engine/types";
import type { BoardCoordinator } from "../board/BoardCoordinator";
import type { NoodlesBoard } from "../engine/board";

/**
 * Pre-computes all valid placements for every piece and provides helpers
 * for finding the best placement near a target board position.
 */
export function usePlacementFinder(board: NoodlesBoard, coordinator: BoardCoordinator) {
  const placementsByPiece = useMemo(() => {
    const result: Record<number, PiecePlacement[]> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      result[piece.id] = generatePlacementsForPiece(piece.id, board);
    });
    return result;
  }, [board]);

  /**
   * Returns placements for pieceId that don't overlap any position in occupiedByOthers.
   */
  const getFreePlacements = useCallback(
    (pieceId: number, occupiedByOthers: Set<number>): PiecePlacement[] => {
      return placementsByPiece[pieceId].filter((p) =>
        p.positions.every((pos) => !occupiedByOthers.has(pos)),
      );
    },
    [placementsByPiece],
  );

  /**
   * Finds the free placement for pieceId that is closest to (targetRow, targetCol).
   * When allowOrientationFallback is true and no placement matches orientationIndex,
   * falls back to any free placement.
   */
  const findBestPlacement = useCallback(
    (
      pieceId: number,
      orientationIndex: number,
      targetRow: number,
      targetCol: number,
      occupiedByOthers: Set<number>,
      allowOrientationFallback = false,
    ): PiecePlacement | null => {
      const free = getFreePlacements(pieceId, occupiedByOthers);
      const samOrientation = free.filter((p) => p.orientationIndex === orientationIndex);
      const pool = samOrientation.length > 0 || !allowOrientationFallback ? samOrientation : free;

      if (pool.length === 0) return null;

      let best: PiecePlacement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const placement of pool) {
        let sumRow = 0, sumCol = 0;
        for (const pos of placement.positions) {
          const [r, c] = coordinator.toRowCol(pos);
          sumRow += r;
          sumCol += c;
        }
        const centerRow = sumRow / placement.positions.length;
        const centerCol = sumCol / placement.positions.length;
        const score = (centerRow - targetRow) ** 2 + (centerCol - targetCol) ** 2;
        if (score < bestScore) { bestScore = score; best = placement; }
      }

      return best;
    },
    [getFreePlacements, coordinator],
  );

  /**
   * Returns a map of orientationIndex → count of free placements for pieceId.
   */
  const countFreePlacementsByOrientation = useCallback(
    (pieceId: number, occupiedByOthers: Set<number>): Record<number, number> => {
      return getFreePlacements(pieceId, occupiedByOthers).reduce<Record<number, number>>((acc, p) => {
        acc[p.orientationIndex] = (acc[p.orientationIndex] ?? 0) + 1;
        return acc;
      }, {});
    },
    [getFreePlacements],
  );

  return {
    placementsByPiece,
    getFreePlacements,
    findBestPlacement,
    countFreePlacementsByOrientation,
  };
}

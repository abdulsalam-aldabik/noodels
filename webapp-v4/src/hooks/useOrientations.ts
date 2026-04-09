import { useMemo, useState } from "react";
import { IQ_NOODLES_PIECES } from "../engine/constants";
import { findAllOrientations } from "../engine/orientation";
import type { PiecePlacement } from "../engine/types";

interface OrientationMeta {
  mirrored: boolean;
  rotationSteps: 0 | 1 | 2 | 3;
}

/**
 * Manages orientation state for all pieces.
 *
 * "Rotate" cycles through orientations that share the current mirror state,
 * ordered by rotationSteps. "Flip" switches to the opposite mirror state at
 * the same (or nearest) rotation step.
 */
export function useOrientations(placementsByPiece: Record<number, PiecePlacement[]>) {
  const [orientationByPiece, setOrientationByPiece] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => { initial[piece.id] = 0; });
    return initial;
  });

  const orientationCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      counts[piece.id] = findAllOrientations(piece).length;
    });
    return counts;
  }, []);

  // Build a meta map: orientationIndex → { mirrored, rotationSteps } per piece.
  // Derived from placements so it stays consistent with what the engine knows.
  const orientationMetaByPiece = useMemo(() => {
    const meta: Record<number, Record<number, OrientationMeta>> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      const byOrientation: Record<number, OrientationMeta> = {};
      placementsByPiece[piece.id]?.forEach((placement) => {
        if (byOrientation[placement.orientationIndex] === undefined) {
          byOrientation[placement.orientationIndex] = {
            mirrored: placement.mirrored ?? false,
            rotationSteps: placement.rotationSteps ?? 0,
          };
        }
      });
      meta[piece.id] = byOrientation;
    });
    return meta;
  }, [placementsByPiece]);

  // Sorted list of available orientation indices per piece.
  const orientationIndicesByPiece = useMemo(() => {
    const indices: Record<number, number[]> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      indices[piece.id] = Object.keys(orientationMetaByPiece[piece.id])
        .map(Number)
        .sort((a, b) => a - b);
    });
    return indices;
  }, [orientationMetaByPiece]);

  /** Returns the next orientation index cycling through same-mirror orientations by rotationSteps. */
  function getNextOrientationIndex(pieceId: number, current: number): number {
    const available = orientationIndicesByPiece[pieceId] ?? [];
    if (available.length === 0) return current;

    const currentMeta = orientationMetaByPiece[pieceId]?.[current];
    if (!currentMeta) return available[0];

    const sameMirror = available.filter(
      (i) => (orientationMetaByPiece[pieceId]?.[i]?.mirrored ?? false) === currentMeta.mirrored,
    );

    const pool = (sameMirror.length > 0 ? sameMirror : available)
      .slice()
      .sort((a, b) => {
        const ra = orientationMetaByPiece[pieceId]?.[a]?.rotationSteps ?? 0;
        const rb = orientationMetaByPiece[pieceId]?.[b]?.rotationSteps ?? 0;
        return ra - rb || a - b;
      });

    const idx = pool.indexOf(current);
    return pool[(idx < 0 ? 0 : idx + 1) % pool.length];
  }

  /** Returns the orientation index with the opposite mirror state, preserving rotation step when possible. */
  function getFlippedOrientationIndex(pieceId: number, current: number): number {
    const available = orientationIndicesByPiece[pieceId] ?? [];
    const currentMeta = orientationMetaByPiece[pieceId]?.[current];
    if (!currentMeta) return current;

    const opposite = available.filter(
      (i) => (orientationMetaByPiece[pieceId]?.[i]?.mirrored ?? false) !== currentMeta.mirrored,
    );
    if (opposite.length === 0) return current;

    const matchingRotation = opposite.find(
      (i) => (orientationMetaByPiece[pieceId]?.[i]?.rotationSteps ?? 0) === currentMeta.rotationSteps,
    );
    return matchingRotation ?? opposite[0];
  }

  function setOrientation(pieceId: number, orientationIndex: number): void {
    setOrientationByPiece((prev) => ({ ...prev, [pieceId]: orientationIndex }));
  }

  function rotate(pieceId: number): void {
    setOrientationByPiece((prev) => ({
      ...prev,
      [pieceId]: getNextOrientationIndex(pieceId, prev[pieceId]),
    }));
  }

  function flip(pieceId: number): void {
    setOrientationByPiece((prev) => ({
      ...prev,
      [pieceId]: getFlippedOrientationIndex(pieceId, prev[pieceId]),
    }));
  }

  return {
    orientationByPiece,
    orientationCounts,
    orientationMetaByPiece,
    orientationIndicesByPiece,
    setOrientation,
    rotate,
    flip,
    getNextOrientationIndex,
    getFlippedOrientationIndex,
  };
}

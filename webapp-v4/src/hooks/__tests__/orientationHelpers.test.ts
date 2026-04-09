/**
 * Tests for the orientation cycling logic that lives inside useOrientations.
 *
 * We test the algorithm by constructing the same data structures the hook builds
 * (orientationMetaByPiece + orientationIndicesByPiece) from real piece data,
 * then verifying the rotate/flip behaviour directly.
 */

import { describe, expect, test } from "vitest";

import { IQ_NOODLES_PIECES } from "../../engine/constants";
import { generatePlacementsForPiece } from "../../engine/placements";

// ─── Helpers (mirrors useOrientations internals) ────────────────────────────

type OrientationMeta = { mirrored: boolean; rotationSteps: 0 | 1 | 2 | 3 };

function buildOrientationMeta(pieceId: number): {
  meta: Record<number, OrientationMeta>;
  indices: number[];
} {
  const byOrientation: Record<number, OrientationMeta> = {};
  for (const p of generatePlacementsForPiece(pieceId)) {
    byOrientation[p.orientationIndex] ??= {
      mirrored: p.mirrored ?? false,
      rotationSteps: p.rotationSteps ?? 0,
    };
  }
  const indices = Object.keys(byOrientation).map(Number).sort((a, b) => a - b);
  return { meta: byOrientation, indices };
}

function getNextOrientationIndex(
  current: number,
  meta: Record<number, OrientationMeta>,
  indices: number[],
): number {
  if (indices.length === 0) return current;
  const currentMeta = meta[current];
  if (!currentMeta) return indices[0];

  const sameMirror = indices.filter(
    (i) => (meta[i]?.mirrored ?? false) === currentMeta.mirrored,
  );
  const pool = (sameMirror.length > 0 ? sameMirror : indices)
    .slice()
    .sort((a, b) => {
      const ra = meta[a]?.rotationSteps ?? 0;
      const rb = meta[b]?.rotationSteps ?? 0;
      return ra - rb || a - b;
    });

  const idx = pool.indexOf(current);
  return pool[(idx < 0 ? 0 : idx + 1) % pool.length];
}

function getFlippedOrientationIndex(
  current: number,
  meta: Record<number, OrientationMeta>,
  indices: number[],
): number {
  const currentMeta = meta[current];
  if (!currentMeta) return current;

  const opposite = indices.filter(
    (i) => (meta[i]?.mirrored ?? false) !== currentMeta.mirrored,
  );
  if (opposite.length === 0) return current;

  const matchingRotation = opposite.find(
    (i) => (meta[i]?.rotationSteps ?? 0) === currentMeta.rotationSteps,
  );
  return matchingRotation ?? opposite[0];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("orientation cycling — getNextOrientationIndex", () => {
  test("cycles through all same-mirror orientations and wraps", () => {
    // Piece C (id=1) has 4 orientations, all non-mirrored
    const { meta, indices } = buildOrientationMeta(1);

    const cycle: number[] = [];
    let current = indices[0];
    for (const _ of indices) {
      void _;
      cycle.push(current);
      current = getNextOrientationIndex(current, meta, indices);
    }

    expect(cycle).toHaveLength(indices.length);
    cycle.forEach((oi) => {
      expect(meta[oi]?.mirrored).toBe(meta[indices[0]]?.mirrored);
    });
    // Wraps back to start after a full cycle
    expect(current).toBe(cycle[0]);
  });

  test("for a mirrored piece, rotate stays within the same mirror group", () => {
    // Piece J (id=0) has 8 orientations split between mirrored and non-mirrored
    const { meta, indices } = buildOrientationMeta(0);

    const mirroredIndices = indices.filter((i) => meta[i]?.mirrored);
    const nonMirroredIndices = indices.filter((i) => !meta[i]?.mirrored);
    expect(mirroredIndices.length).toBeGreaterThan(0);
    expect(nonMirroredIndices.length).toBeGreaterThan(0);

    const nextNonMirrored = getNextOrientationIndex(nonMirroredIndices[0], meta, indices);
    expect(meta[nextNonMirrored]?.mirrored).toBe(false);

    const nextMirrored = getNextOrientationIndex(mirroredIndices[0], meta, indices);
    expect(meta[nextMirrored]?.mirrored).toBe(true);
  });
});

describe("orientation cycling — getFlippedOrientationIndex", () => {
  test("flip switches mirror state", () => {
    const { meta, indices } = buildOrientationMeta(0); // Piece J — has both mirrored/non-mirrored

    const nonMirroredOi = indices.find((i) => !meta[i]?.mirrored);
    expect(nonMirroredOi).toBeDefined();
    const flipped = getFlippedOrientationIndex(nonMirroredOi!, meta, indices);
    expect(meta[flipped]?.mirrored).toBe(true);

    // Flip back
    const flippedBack = getFlippedOrientationIndex(flipped, meta, indices);
    expect(meta[flippedBack]?.mirrored).toBe(false);
  });

  test("flip preserves rotation step when a match exists", () => {
    const { meta, indices } = buildOrientationMeta(0); // Piece J — 8 orientations

    for (const oi of indices) {
      const flipped = getFlippedOrientationIndex(oi, meta, indices);
      if (flipped === oi) continue;

      const targetMirrored = !(meta[oi]?.mirrored ?? false);
      const sameRotation = indices.find(
        (i) => (meta[i]?.mirrored ?? false) === targetMirrored
          && (meta[i]?.rotationSteps ?? 0) === (meta[oi]?.rotationSteps ?? 0),
      );
      if (sameRotation !== undefined) {
        expect(flipped).toBe(sameRotation);
      }
    }
  });

  test("flip is a no-op for pieces with only non-mirrored orientations", () => {
    // Piece C (id=1) — 4 orientations, all non-mirrored
    const { meta, indices } = buildOrientationMeta(1);
    expect(indices.every((i) => !(meta[i]?.mirrored ?? false))).toBe(true);

    const start = indices[0];
    expect(getFlippedOrientationIndex(start, meta, indices)).toBe(start);
  });
});

describe("orientation data sanity", () => {
  test("all 11 pieces have at least 1 orientation index", () => {
    IQ_NOODLES_PIECES.forEach((piece) => {
      const { indices } = buildOrientationMeta(piece.id);
      expect(indices.length).toBeGreaterThan(0);
    });
  });

  test("each orientation index maps to a valid mirrored/rotationSteps pair", () => {
    IQ_NOODLES_PIECES.forEach((piece) => {
      const { meta, indices } = buildOrientationMeta(piece.id);
      indices.forEach((oi) => {
        const m = meta[oi];
        expect(m).toBeDefined();
        expect(typeof m?.mirrored).toBe("boolean");
        expect([0, 1, 2, 3]).toContain(m?.rotationSteps);
      });
    });
  });
});

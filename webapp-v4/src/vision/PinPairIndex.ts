/**
 * Pin-visit index over every canonical placement.
 *
 * For each placement in {@link getPlacementIndex}, records which of the 21
 * pins the piece occupies (any cell of the pin's 4-quad is in the placement).
 * Exposes forward lookup (pieceId → placements) and reverse lookup
 * (pieceId × unordered pin-set → placements).
 *
 * Scope note — rope endpoints vs. visited pins:
 *   An IQ Noodles piece is a rope with 2 tips, but it can thread through N
 *   pins (N ≥ 2). Identifying the 2 "endpoint" pins requires rope-topology
 *   analysis (CURVE shapes don't encode their 90° orientation, so neighbor
 *   adjacency isn't directly derivable from SegmentShape alone). That is
 *   deferred to the piece-endpoint extractor in Phase 2 of the scan
 *   pipeline, where the extractor works against the detected mask and
 *   uses this index's visited-pin set as the validation target.
 */

import { POSITIONS_AROUND_PINS } from "../engine/constants";
import { getPlacementIndex, type CanonicalPlacement } from "./placementIndex";

export const PIN_COUNT = POSITIONS_AROUND_PINS.length;

export interface PinVisitPlacement extends CanonicalPlacement {
  /** Sorted pin indices this placement occupies (each pin has ≥1 cell in its 4-quad). */
  pinsVisited: number[];
}

/** Builds cellKey → pinIndex once, used for pin-visit derivation. */
function buildCellToPin(): Int8Array {
  const map = new Int8Array(14 * 14).fill(-1);
  POSITIONS_AROUND_PINS.forEach((cells, pinIndex) => {
    for (const cell of cells) map[cell] = pinIndex;
  });
  return map;
}

function stableKey(pins: readonly number[]): string {
  return pins.join(",");
}

let forwardCache: Map<number, PinVisitPlacement[]> | null = null;
let reverseCache: Map<number, Map<string, PinVisitPlacement[]>> | null = null;

function build(): {
  forward: Map<number, PinVisitPlacement[]>;
  reverse: Map<number, Map<string, PinVisitPlacement[]>>;
} {
  if (forwardCache && reverseCache) {
    return { forward: forwardCache, reverse: reverseCache };
  }
  const cellToPin = buildCellToPin();
  const forward = new Map<number, PinVisitPlacement[]>();
  const reverse = new Map<number, Map<string, PinVisitPlacement[]>>();

  for (const [classId, placements] of getPlacementIndex()) {
    const enriched: PinVisitPlacement[] = [];
    const byKey = new Map<string, PinVisitPlacement[]>();

    for (const pl of placements) {
      const pinSet = new Set<number>();
      for (const cellKey of pl.cellSet) {
        const pin = cellToPin[cellKey];
        if (pin >= 0) pinSet.add(pin);
      }
      const pinsVisited = [...pinSet].sort((a, b) => a - b);
      const entry: PinVisitPlacement = { ...pl, pinsVisited };
      enriched.push(entry);

      const key = stableKey(pinsVisited);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(entry);
      else byKey.set(key, [entry]);
    }

    forward.set(classId, enriched);
    reverse.set(classId, byKey);
  }

  forwardCache = forward;
  reverseCache = reverse;
  return { forward, reverse };
}

/** All placements for a given piece class, each annotated with its visited pin indices. */
export function getPlacementsByClass(classId: number): PinVisitPlacement[] {
  return build().forward.get(classId) ?? [];
}

/**
 * Placements of `classId` whose visited-pin set exactly equals `pinSet`.
 * Empty array if no placement matches (caller should treat as "illegal scan").
 */
export function findPlacementsByPinSet(
  classId: number,
  pinSet: Iterable<number>,
): PinVisitPlacement[] {
  const sorted = [...new Set(pinSet)].sort((a, b) => a - b);
  const byKey = build().reverse.get(classId);
  if (!byKey) return [];
  return byKey.get(stableKey(sorted)) ?? [];
}

/** True iff (classId, pinSet) is a legal placement on the canonical board. */
export function isLegalPinSet(classId: number, pinSet: Iterable<number>): boolean {
  return findPlacementsByPinSet(classId, pinSet).length > 0;
}

/** Test-only: reset memoization. Do not use in app code. */
export function __resetPinPairIndexForTests(): void {
  forwardCache = null;
  reverseCache = null;
}

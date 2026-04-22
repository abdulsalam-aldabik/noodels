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

/**
 * Fuzzy lookup: exact match first, then try removing each pin one at a time
 * (tolerance = 1 missed pin). Returns the first non-empty result found.
 * Subset matching is safe because singletons are always empty (placements
 * require ≥2 pins), so spurious short-circuit matches are prevented.
 */
export function findPlacementsByPinSetFuzzy(
  classId: number,
  pinSet: Iterable<number>,
): PinVisitPlacement[] {
  const sorted = [...new Set(pinSet)].sort((a, b) => a - b);
  const exact = findPlacementsByPinSet(classId, sorted);
  if (exact.length > 0) return exact;

  for (let i = 0; i < sorted.length; i++) {
    const reduced = sorted.filter((_, j) => j !== i);
    if (reduced.length < 2) continue;
    const matches = findPlacementsByPinSet(classId, reduced);
    if (matches.length > 0) return matches;
  }
  return [];
}

/**
 * Jaccard similarity between two pin sets: |A ∩ B| / |A ∪ B|.
 * Returns 0 if both sets are empty.
 */
export function pinSetJaccard(
  detectedPins: readonly number[],
  placementPins: readonly number[],
): number {
  const a = new Set(detectedPins);
  const b = new Set(placementPins);
  let intersection = 0;
  for (const pin of a) {
    if (b.has(pin)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** All placements across all piece classes, each annotated with visited pins. */
export function getAllPlacementsWithPins(): PinVisitPlacement[] {
  const { forward } = build();
  const all: PinVisitPlacement[] = [];
  for (const entries of forward.values()) {
    all.push(...entries);
  }
  return all;
}

/** Test-only: reset memoization. Do not use in app code. */
export function __resetPinPairIndexForTests(): void {
  forwardCache = null;
  reverseCache = null;
}

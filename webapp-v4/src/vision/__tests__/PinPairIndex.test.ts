import { describe, it, expect, beforeEach } from "vitest";
import {
  PIN_COUNT,
  getPlacementsByClass,
  findPlacementsByPinSet,
  isLegalPinSet,
  __resetPinPairIndexForTests,
} from "../PinPairIndex";
import { getPlacementIndex } from "../placementIndex";
import { IQ_NOODLES_PIECES, POSITIONS_AROUND_PINS } from "../../engine/constants";

beforeEach(() => {
  __resetPinPairIndexForTests();
});

describe("PinPairIndex", () => {
  it("exposes PIN_COUNT = 21 (matches POSITIONS_AROUND_PINS)", () => {
    expect(PIN_COUNT).toBe(21);
    expect(POSITIONS_AROUND_PINS.length).toBe(21);
  });

  it("every piece class (0..10) has at least one placement", () => {
    for (const piece of IQ_NOODLES_PIECES) {
      const placements = getPlacementsByClass(piece.id);
      expect(placements.length).toBeGreaterThan(0);
    }
  });

  it("every placement visits ≥2 pins, all in [0, PIN_COUNT)", () => {
    for (const piece of IQ_NOODLES_PIECES) {
      const placements = getPlacementsByClass(piece.id);
      for (const pl of placements) {
        expect(pl.pinsVisited.length).toBeGreaterThanOrEqual(2);
        for (const pin of pl.pinsVisited) {
          expect(pin).toBeGreaterThanOrEqual(0);
          expect(pin).toBeLessThan(PIN_COUNT);
        }
      }
    }
  });

  it("pinsVisited is sorted ascending and deduplicated", () => {
    for (const piece of IQ_NOODLES_PIECES) {
      for (const pl of getPlacementsByClass(piece.id)) {
        for (let i = 1; i < pl.pinsVisited.length; i++) {
          expect(pl.pinsVisited[i]).toBeGreaterThan(pl.pinsVisited[i - 1]);
        }
      }
    }
  });

  it("placement count matches underlying placementIndex (enrichment is 1:1)", () => {
    const raw = getPlacementIndex();
    for (const piece of IQ_NOODLES_PIECES) {
      const enriched = getPlacementsByClass(piece.id);
      expect(enriched.length).toBe(raw.get(piece.id)?.length ?? 0);
    }
  });

  it("round-trip: every placement is retrievable by its own pinsVisited", () => {
    for (const piece of IQ_NOODLES_PIECES) {
      const placements = getPlacementsByClass(piece.id);
      for (const pl of placements) {
        const hits = findPlacementsByPinSet(piece.id, pl.pinsVisited);
        expect(hits.length).toBeGreaterThan(0);
        const byOrientation = hits.find(
          (h) =>
            h.orientationIndex === pl.orientationIndex &&
            h.topLeftCell.row === pl.topLeftCell.row &&
            h.topLeftCell.col === pl.topLeftCell.col,
        );
        expect(byOrientation).toBeDefined();
      }
    }
  });

  it("isLegalPinSet accepts every real placement's pin set", () => {
    for (const piece of IQ_NOODLES_PIECES) {
      for (const pl of getPlacementsByClass(piece.id)) {
        expect(isLegalPinSet(piece.id, pl.pinsVisited)).toBe(true);
      }
    }
  });

  it("isLegalPinSet rejects obviously illegal sets", () => {
    // Empty set cannot be covered by any piece.
    expect(isLegalPinSet(0, [])).toBe(false);
    // Out-of-range pin index.
    expect(isLegalPinSet(0, [99])).toBe(false);
    // Single pin — every IQ Noodles piece spans ≥2 pins.
    for (const piece of IQ_NOODLES_PIECES) {
      expect(isLegalPinSet(piece.id, [0])).toBe(false);
    }
  });

  it("findPlacementsByPinSet tolerates duplicate and unsorted inputs", () => {
    const sample = getPlacementsByClass(0)[0];
    const pins = sample.pinsVisited;
    const shuffled = [...pins].reverse();
    const dupes = [...pins, ...pins];
    expect(findPlacementsByPinSet(0, shuffled).length).toBeGreaterThan(0);
    expect(findPlacementsByPinSet(0, dupes).length).toBeGreaterThan(0);
  });

  it("unknown classId returns empty arrays, not throws", () => {
    expect(getPlacementsByClass(999)).toEqual([]);
    expect(findPlacementsByPinSet(999, [0, 1])).toEqual([]);
    expect(isLegalPinSet(999, [0, 1])).toBe(false);
  });

  it("memoization: repeated calls return referentially-stable arrays", () => {
    const a = getPlacementsByClass(0);
    const b = getPlacementsByClass(0);
    expect(a).toBe(b);
  });
});

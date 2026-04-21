import { describe, it, expect } from "vitest";
import { locatePins } from "../PinLocator";
import { PIN_CLASS_ID, type RawDetection } from "../../inference/types";

function makePinDetection(
  cx: number,
  cy: number,
  radius: number,
  score: number,
): RawDetection {
  // Stamp a filled circle into a small mask grid.
  const m = Math.max(8, Math.ceil(radius * 2) + 2);
  const data = new Uint8Array(m * m);
  const mid = m / 2;
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < m; x++) {
      const dx = x + 0.5 - mid;
      const dy = y + 0.5 - mid;
      if (dx * dx + dy * dy <= radius * radius) {
        data[y * m + x] = 1;
      }
    }
  }
  return {
    classId: PIN_CLASS_ID,
    className: "pin",
    score,
    bbox: { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 },
    mask: { width: m, height: m, data },
  };
}

describe("PinLocator", () => {
  it("filters non-pin classes", () => {
    const dets: RawDetection[] = [
      { classId: 0, className: "A", score: 0.9, bbox: { x: 10, y: 10, width: 5, height: 5 } },
      { classId: 11, className: "board", score: 0.9, bbox: { x: 0, y: 0, width: 100, height: 100 } },
    ];
    expect(locatePins(dets)).toHaveLength(0);
  });

  it("returns mask centroid in image px", () => {
    const det = makePinDetection(100, 200, 3, 0.9);
    const pins = locatePins([det]);
    expect(pins).toHaveLength(1);
    expect(pins[0].center.x).toBeCloseTo(100, 0);
    expect(pins[0].center.y).toBeCloseTo(200, 0);
    expect(pins[0].score).toBe(0.9);
    expect(pins[0].sourceDetectionIndex).toBe(0);
    expect(pins[0].radiusPx).toBeGreaterThan(1.5);
  });

  it("sorts by score descending and applies score floor", () => {
    const dets: RawDetection[] = [
      makePinDetection(50, 50, 3, 0.2),   // below default floor (0.25)
      makePinDetection(100, 100, 3, 0.8),
      makePinDetection(150, 150, 3, 0.5),
    ];
    const pins = locatePins(dets);
    expect(pins).toHaveLength(2);
    expect(pins[0].score).toBe(0.8);
    expect(pins[1].score).toBe(0.5);
  });

  it("falls back to bbox center when mask is absent", () => {
    const det: RawDetection = {
      classId: PIN_CLASS_ID,
      className: "pin",
      score: 0.7,
      bbox: { x: 20, y: 40, width: 6, height: 6 },
    };
    const pins = locatePins([det]);
    expect(pins).toHaveLength(1);
    expect(pins[0].center.x).toBeCloseTo(23);
    expect(pins[0].center.y).toBeCloseTo(43);
  });
});

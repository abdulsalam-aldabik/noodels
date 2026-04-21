import { describe, it, expect } from "vitest";
import { snapPiecesToPins } from "../PinSnapper";
import { computePinBoardPoints } from "../../board/gridGeometry";
import type { RawDetection } from "../../inference/types";

/**
 * Identity image→board homography: image px are already board-space cells.
 * Used so tests can stamp mask rectangles directly in cell coordinates.
 */
const IDENTITY_H = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Build a piece detection whose mask, after bbox scaling, covers the
 * axis-aligned board-space rectangle [x0..x1] × [y0..y1] (cell units).
 * The identity homography means image px == board units.
 */
function makePieceDetection(
  classId: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): RawDetection {
  const width = x1 - x0;
  const height = y1 - y0;
  const mw = Math.max(4, Math.round(width * 4));
  const mh = Math.max(4, Math.round(height * 4));
  const data = new Uint8Array(mw * mh).fill(1);
  return {
    classId,
    className: `piece_${classId}`,
    score: 0.9,
    bbox: { x: x0, y: y0, width, height },
    mask: { width: mw, height: mh, data },
  };
}

describe("snapPiecesToPins", () => {
  it("ignores non-piece classes", () => {
    const det: RawDetection = {
      classId: 11, // board
      className: "board",
      score: 0.9,
      bbox: { x: 0, y: 0, width: 14, height: 14 },
    };
    const out = snapPiecesToPins([det], IDENTITY_H);
    expect(out).toHaveLength(0);
  });

  it("detects visited pins whose centers fall inside the mask footprint", () => {
    // Pin 0 is at board-space (4.5, 0.5), pin 1 is at (8.5, 0.5)
    // (averages of cell centers of the 4 cells around each pin).
    const pins = computePinBoardPoints();
    expect(pins[0].x).toBe(4.5);
    expect(pins[0].y).toBe(0.5);
    expect(pins[1].x).toBe(8.5);
    expect(pins[1].y).toBe(0.5);

    // Mask covering both pins.
    const det = makePieceDetection(0, 3, 0, 10, 1);
    const [assignment] = snapPiecesToPins([det], IDENTITY_H);
    expect(assignment.visitedPins).toContain(0);
    expect(assignment.visitedPins).toContain(1);
  });

  it("produces endpoint pins for a long axis-aligned mask", () => {
    // Horizontal strip from x=4 to x=9 along y=0.5. PCA endpoints land near
    // (4, 0.5) and (9, 0.5) — within 0.9 cells of pins 0 (4.5, 0.5) and 1 (8.5, 0.5).
    const det = makePieceDetection(0, 4, 0.3, 9, 0.7);
    const [assignment] = snapPiecesToPins([det], IDENTITY_H);
    expect(assignment.endpoints).not.toBeNull();
    expect(assignment.endpointPins).not.toBeNull();
    if (assignment.endpointPins) {
      expect(assignment.endpointPins).toEqual([0, 1]);
    }
  });

  it("returns empty visitedPins when mask is far from all pins", () => {
    // Pin 0 center is (4.5, 0.5). A tiny mask near (13.3, 13.3) is beyond any pin.
    const det = makePieceDetection(0, 13.3, 13.3, 13.5, 13.5);
    const [assignment] = snapPiecesToPins([det], IDENTITY_H);
    expect(assignment.visitedPins).toEqual([]);
  });

  it("visitedPins is sorted and deduplicated", () => {
    const det = makePieceDetection(0, 1, 1, 13, 13);
    const [assignment] = snapPiecesToPins([det], IDENTITY_H);
    const sorted = [...assignment.visitedPins].sort((a, b) => a - b);
    expect(assignment.visitedPins).toEqual(sorted);
    expect(new Set(assignment.visitedPins).size).toBe(assignment.visitedPins.length);
  });
});

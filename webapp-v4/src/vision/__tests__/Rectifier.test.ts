import { describe, expect, it } from "vitest";

import type { Point2D } from "../../inference/types";
import {
  applyHomography,
  computeHomography4,
  invert3x3,
} from "../Rectifier";

type Quad = [Point2D, Point2D, Point2D, Point2D];

describe("Rectifier homography math", () => {
  const src: Quad = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  const dst: Quad = [
    { x: 100, y: 80 },
    { x: 380, y: 70 },
    { x: 340, y: 320 },
    { x: 120, y: 300 },
  ];

  it("maps each source corner onto its destination corner", () => {
    const H = computeHomography4(src, dst);
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(H, src[i].x, src[i].y);
      expect(mapped.x).toBeCloseTo(dst[i].x, 6);
      expect(mapped.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("round-trips points through homography and inverse", () => {
    const H = computeHomography4(src, dst);
    const Hinv = invert3x3(H);
    const points = [
      { x: 0.25, y: 0.3 },
      { x: 1.2, y: 0.7 },
      { x: 1.6, y: 1.4 },
      { x: 0.5, y: 1.8 },
    ];

    for (const p of points) {
      const warped = applyHomography(H, p.x, p.y);
      const back = applyHomography(Hinv, warped.x, warped.y);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it("throws when trying to invert a singular matrix", () => {
    const singular = [
      1, 2, 3,
      2, 4, 6,
      0, 1, 1,
    ];
    expect(() => invert3x3(singular)).toThrow(/singular/i);
  });

  it("throws when source points produce a singular homography system", () => {
    const srcDegenerate: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    expect(() => computeHomography4(srcDegenerate, dst)).toThrow(/singular/i);
  });
});
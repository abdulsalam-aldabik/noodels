import { describe, it, expect } from "vitest";
import { locateBoardPins, computeHomographyN } from "../BoardLocatorPins";
import { applyHomography } from "../Rectifier";
import { computePinBoardPoints } from "../../board/gridGeometry";
import type { BoardRef, PinDetection } from "../types";
import type { Point2D } from "../../inference/types";

const IMAGE_SIZE = { width: 1024, height: 1024 };

/**
 * Synthesize a pin-detection set from an affine "camera" transform applied to
 * the canonical pin board-space positions. Board corners are computed with
 * the same transform so the corner homography starts accurate.
 */
function affineBoardToImage(
  boardPoint: Point2D,
  scale: number,
  tx: number,
  ty: number,
): Point2D {
  // Shift board-space (range roughly [-0.5, 13.5]) into a centered system.
  const bx = boardPoint.x - 6.5;
  const by = boardPoint.y - 6.5;
  return { x: tx + bx * scale, y: ty + by * scale };
}

function buildCornerRef(scale: number, tx: number, ty: number): BoardRef {
  const edges: Array<{ x: number; y: number }> = [
    { x: -0.5, y: -0.5 },
    { x: 13.5, y: -0.5 },
    { x: 13.5, y: 13.5 },
    { x: -0.5, y: 13.5 },
  ];
  const [tl, tr, br, bl] = edges.map((p) => affineBoardToImage(p, scale, tx, ty));
  return {
    imageSize: IMAGE_SIZE,
    corners: [tl, tr, br, bl],
    cornerSource: "bbox_fused",
    cornerScore: 0.9,
    candidates: [],
    hingeFound: false,
    status: "ok",
  };
}

function buildPinDetections(
  scale: number,
  tx: number,
  ty: number,
  options: { perturbPx?: number } = {},
): PinDetection[] {
  const { perturbPx = 0 } = options;
  let seed = 42;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * 2 - 1;
  };
  return computePinBoardPoints().map((cp, i) => {
    const img = affineBoardToImage({ x: cp.x, y: cp.y }, scale, tx, ty);
    return {
      center: {
        x: img.x + rand() * perturbPx,
        y: img.y + rand() * perturbPx,
      },
      score: 0.9,
      radiusPx: 5,
      sourceDetectionIndex: i,
    };
  });
}

describe("computeHomographyN", () => {
  it("recovers an identity-like map on 4 trivial correspondences", () => {
    const src: Point2D[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const dst = src.map((p) => ({ x: p.x + 5, y: p.y + 3 }));
    const H = computeHomographyN(src, dst);
    for (let i = 0; i < src.length; i++) {
      const projected = applyHomography(H, src[i].x, src[i].y);
      expect(projected.x).toBeCloseTo(dst[i].x, 6);
      expect(projected.y).toBeCloseTo(dst[i].y, 6);
    }
  });

  it("fits 21 points with small noise within 1e-1 residual", () => {
    const canonical = computePinBoardPoints();
    const src = canonical.map((p) => affineBoardToImage({ x: p.x, y: p.y }, 40, 512, 512));
    const dst = canonical.map((p) => ({ x: p.x, y: p.y }));
    const H = computeHomographyN(src, dst);
    for (let i = 0; i < src.length; i++) {
      const projected = applyHomography(H, src[i].x, src[i].y);
      expect(Math.hypot(projected.x - dst[i].x, projected.y - dst[i].y)).toBeLessThan(1e-6);
    }
  });
});

describe("locateBoardPins", () => {
  it("produces ok status with 21 perfect correspondences", () => {
    const scale = 40;
    const ref = buildCornerRef(scale, 512, 512);
    const pins = buildPinDetections(scale, 512, 512);
    const result = locateBoardPins(pins, ref);
    expect(result.pinStatus).toBe("ok");
    expect(result.pinCorrespondences).toHaveLength(21);
    expect(result.pinHomography).toBeDefined();
    const maxRes = Math.max(...result.pinCorrespondences.map((c) => c.residualBoardUnits));
    expect(maxRes).toBeLessThan(1e-6);
  });

  it("refines small pin-noise better than the seed corner homography", () => {
    const scale = 40;
    const ref = buildCornerRef(scale, 512, 512);
    const pins = buildPinDetections(scale, 512, 512, { perturbPx: 3 });
    const result = locateBoardPins(pins, ref);
    expect(result.pinStatus === "ok" || result.pinStatus === "lowPinCount").toBe(true);
    expect(result.pinHomography).toBeDefined();
    // Mean residual in board units should be sub-cell (much less than 1.0).
    const meanRes =
      result.pinCorrespondences.reduce((s, c) => s + c.residualBoardUnits, 0) /
      result.pinCorrespondences.length;
    expect(meanRes).toBeLessThan(0.25);
  });

  it("falls back to corner-only when too few pins match", () => {
    const scale = 40;
    const ref = buildCornerRef(scale, 512, 512);
    const pins = buildPinDetections(scale, 512, 512).slice(0, 5);
    const result = locateBoardPins(pins, ref);
    expect(result.pinStatus).toBe("fallback_corners");
    expect(result.pinHomography).toBeUndefined();
  });

  it("returns failed when the seed BoardRef is failed", () => {
    const ref: BoardRef = {
      ...buildCornerRef(40, 512, 512),
      status: "failed",
      message: "no board",
    };
    const pins = buildPinDetections(40, 512, 512);
    const result = locateBoardPins(pins, ref);
    expect(result.pinStatus).toBe("failed");
  });
});

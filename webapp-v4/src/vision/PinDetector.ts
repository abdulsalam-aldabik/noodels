/**
 * PinDetector — finds the 21 physical board pins in the rectified 640×640 image
 * and uses their positions to compute a refined rectified→board homography.
 *
 * Why: corner-based homography has large lever-arm errors at the board edges.
 * The 21 pins are distributed across the interior of the board, are bright white
 * on a dark background, and are visible even when pieces are present (pieces have
 * holes that expose the pins). Detecting them gives N≥4 precise correspondences
 * for a least-squares homography fit — far more robust than 4 noisy corners.
 */

import { POSITIONS_AROUND_PINS, BOARD_WIDTH } from "../engine/constants";
import { computeHomographyLeastSquares } from "./HomographyComputer";
import type { RectifiedGeometry } from "./RectifiedDetector";

// ── Pin grid positions ────────────────────────────────────────────────────────

/**
 * Board pin positions in grid coordinates [col, row].
 * Each pin sits at the center of its 4 surrounding cells.
 * Format: [col, row] — matches the boardCentroid [col, row] convention.
 */
export const PIN_GRID_POSITIONS: [number, number][] = (
  POSITIONS_AROUND_PINS as ReadonlyArray<readonly [number, number, number, number]>
).map(([tl]) => {
  const row = Math.floor(tl / BOARD_WIDTH);
  const col = tl % BOARD_WIDTH;
  return [col + 0.5, row + 0.5];
});

// ── Detection parameters ─────────────────────────────────────────────────────

/** Search radius around expected pin position in rectified pixels.
 *  Pins are ~16px diameter at 40px/cell. 20px gives margin for small warp errors
 *  while keeping adjacent pins (160px apart) well separated. */
const PIN_SEARCH_RADIUS = 20;

/** Minimum luminance (0–255) to count a pixel as part of a pin. */
const PIN_MIN_BRIGHTNESS = 190;

/** Minimum total brightness weight in the search window to confirm a pin.
 *  Prevents stray bright pixels from producing false positives. */
const PIN_MIN_WEIGHT = 60;

// ── Types ────────────────────────────────────────────────────────────────────

export interface DetectedPin {
  gridCol: number;
  gridRow: number;
  /** Sub-pixel centroid in rectified 640×640 image space. */
  rectifiedPx: [number, number];
  /** Peak luminance found in the search window (0–255). */
  brightness: number;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Searches for all 21 board pins in the rectified 640×640 canvas.
 *
 * For each known pin position, computes the expected pixel location in the
 * rectified image, then finds the brightness-weighted centroid of all bright
 * pixels within a 20px search radius. Returns confirmed matches only.
 */
export function detectPinsInRectified(
  imageData: ImageData,
  geometry: Pick<RectifiedGeometry, "gridToPixelScale" | "boardOriginCol" | "boardOriginRow">,
): DetectedPin[] {
  const { data, width, height } = imageData;
  const { gridToPixelScale, boardOriginCol, boardOriginRow } = geometry;

  const detections: DetectedPin[] = [];

  for (const [gridCol, gridRow] of PIN_GRID_POSITIONS) {
    // Expected pin pixel position in the rectified canvas.
    const expectedPx = (gridCol - boardOriginCol) * gridToPixelScale;
    const expectedPy = (gridRow - boardOriginRow) * gridToPixelScale;

    const x0 = Math.max(0, Math.floor(expectedPx - PIN_SEARCH_RADIUS));
    const x1 = Math.min(width - 1, Math.ceil(expectedPx + PIN_SEARCH_RADIUS));
    const y0 = Math.max(0, Math.floor(expectedPy - PIN_SEARCH_RADIUS));
    const y1 = Math.min(height - 1, Math.ceil(expectedPy + PIN_SEARCH_RADIUS));

    if (x0 > x1 || y0 > y1) continue;

    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let maxBrightness = 0;

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px - expectedPx;
        const dy = py - expectedPy;
        if (dx * dx + dy * dy > PIN_SEARCH_RADIUS * PIN_SEARCH_RADIUS) continue;

        const idx = (py * width + px) * 4;
        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];

        if (lum >= PIN_MIN_BRIGHTNESS) {
          const w = lum - PIN_MIN_BRIGHTNESS;
          totalWeight += w;
          weightedX += px * w;
          weightedY += py * w;
          if (lum > maxBrightness) maxBrightness = lum;
        }
      }
    }

    if (totalWeight >= PIN_MIN_WEIGHT) {
      detections.push({
        gridCol,
        gridRow,
        rectifiedPx: [weightedX / totalWeight, weightedY / totalWeight],
        brightness: maxBrightness,
      });
    }
  }

  return detections;
}

/**
 * Computes a refined rectified→board homography from detected pin positions.
 *
 * Uses least-squares DLT with all N≥4 detected pins as correspondences:
 *   detected pixel position → known grid position
 *
 * This replaces the scale-only rectifiedToBoardMatrix from buildRectifiedGeometry
 * with a homography anchored to actual physical pin locations, correcting for
 * any remaining warp errors from the corner-based rectification.
 *
 * Returns null if fewer than 4 pins were detected.
 */
export function computePinRefinedHomography(pins: DetectedPin[]): number[][] | null {
  if (pins.length < 4) return null;

  const srcPoints = pins.map((p) => p.rectifiedPx);
  const dstPoints = pins.map((p) => [p.gridCol, p.gridRow] as [number, number]);

  try {
    return computeHomographyLeastSquares(srcPoints, dstPoints);
  } catch {
    return null;
  }
}

/**
 * Warps a detection mask (or bbox fallback) into the canonical 14×14 board-unit
 * grid and produces per-cell coverage + binarized bitmap structures used by
 * PieceMapperV2. Pure function, no DOM access.
 */

import type { RawDetection } from "../inference/types";

export const COVERAGE_THRESHOLD_DEFAULT = 0.15;

export interface WarpResult {
  cellMask: Uint8Array; // length 196, 0/1
  cellCoverage: Float32Array; // length 196, normalized to [0,1]
  rowBitmap: Uint16Array; // length 14
  totalCells: number;
}

/** Local homogeneous apply so we don't have to pull in Rectifier's DOM code paths. */
function applyHomography(m: number[], x: number, y: number): { x: number; y: number } {
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  return { x: X / W, y: Y / W };
}

export function warpMaskToCells(
  detection: RawDetection,
  forward: number[],
  coverageThreshold: number = COVERAGE_THRESHOLD_DEFAULT,
): WarpResult {
  const pixelCount = new Float32Array(196);
  const bbox = detection.bbox;

  const accumulate = (px: number, py: number): void => {
    const bp = applyHomography(forward, px, py);
    const col = Math.round(bp.x);
    const row = Math.round(bp.y);
    if (row < 0 || row > 13 || col < 0 || col > 13) return;
    pixelCount[row * 14 + col] += 1;
  };

  if (detection.mask) {
    const { width: mw, height: mh, data } = detection.mask;
    if (mw > 0 && mh > 0) {
      const sx = bbox.width / mw;
      const sy = bbox.height / mh;
      for (let my = 0; my < mh; my++) {
        for (let mx = 0; mx < mw; mx++) {
          if (data[my * mw + mx] > 0) {
            const px = bbox.x + (mx + 0.5) * sx;
            const py = bbox.y + (my + 0.5) * sy;
            accumulate(px, py);
          }
        }
      }
    }
  } else {
    // bbox fallback: rasterize filled rectangle at ~0.25-cell step.
    // In image space the cell spacing ≈ bbox.width / (bbox.width in board units).
    // We can't know the board-unit width without calling applyHomography, so we
    // just sample the bbox at a fine-enough pixel step that's at least 4 samples
    // per unit of bbox extent.
    const steps = Math.max(4, Math.ceil(Math.max(bbox.width, bbox.height) * 4));
    const sx = bbox.width / steps;
    const sy = bbox.height / steps;
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < steps; j++) {
        const px = bbox.x + (j + 0.5) * sx;
        const py = bbox.y + (i + 0.5) * sy;
        accumulate(px, py);
      }
    }
  }

  let maxPixelCount = 0;
  for (let i = 0; i < 196; i++) {
    if (pixelCount[i] > maxPixelCount) maxPixelCount = pixelCount[i];
  }

  const cellCoverage = new Float32Array(196);
  const cellMask = new Uint8Array(196);
  const rowBitmap = new Uint16Array(14);
  let totalCells = 0;

  if (maxPixelCount > 0) {
    for (let i = 0; i < 196; i++) {
      const norm = pixelCount[i] / maxPixelCount;
      cellCoverage[i] = norm;
      if (norm >= coverageThreshold) {
        cellMask[i] = 1;
        const row = Math.floor(i / 14);
        const col = i % 14;
        rowBitmap[row] |= 1 << col;
        totalCells++;
      }
    }
  }

  return { cellMask, cellCoverage, rowBitmap, totalCells };
}

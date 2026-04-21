/**
 * Extracts class-13 pin centroids from a YOLO-seg inference result.
 *
 * Each class-13 detection is a tiny disc (~7 px radius by default). We reduce
 * it to a single centroid in source-image pixel coordinates so downstream
 * homography solvers can treat pins as a point set. Falls back to bbox center
 * when a detection has no mask.
 */

import { PIN_CLASS_ID, type RawDetection } from "../inference/types";
import type { PinDetection } from "./types";

/** Centroid of the mask=1 pixels, expressed in source-image pixels. */
function maskCentroidImagePx(d: RawDetection): { cx: number; cy: number; pixels: number } | null {
  const m = d.mask;
  if (!m) return null;
  const { width: mw, height: mh, data } = m;
  const { x: bx, y: by, width: bw, height: bh } = d.bbox;
  if (mw === 0 || mh === 0) return null;

  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      if (data[my * mw + mx] === 0) continue;
      sumX += mx + 0.5;
      sumY += my + 0.5;
      n++;
    }
  }
  if (n === 0) return null;
  const sx = bw / mw;
  const sy = bh / mh;
  return {
    cx: bx + (sumX / n) * sx,
    cy: by + (sumY / n) * sy,
    pixels: n * sx * sy,
  };
}

export interface LocatePinsOptions {
  /** Minimum detection score to accept. Defaults to 0.25 (pins are easy; floor stays low). */
  minScore?: number;
  /** Upper cap on number of pins returned, kept to comfortably exceed 21 + noise. */
  maxPins?: number;
}

export function locatePins(
  detections: RawDetection[],
  options: LocatePinsOptions = {},
): PinDetection[] {
  const minScore = options.minScore ?? 0.25;
  const maxPins = options.maxPins ?? 64;

  const out: PinDetection[] = [];
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    if (d.classId !== PIN_CLASS_ID) continue;
    if (d.score < minScore) continue;

    const centroid = maskCentroidImagePx(d);
    let cx: number;
    let cy: number;
    let areaPx: number;
    if (centroid) {
      cx = centroid.cx;
      cy = centroid.cy;
      areaPx = centroid.pixels;
    } else {
      cx = d.bbox.x + d.bbox.width / 2;
      cy = d.bbox.y + d.bbox.height / 2;
      areaPx = d.bbox.width * d.bbox.height;
    }
    const radiusPx = Math.sqrt(Math.max(areaPx, 1) / Math.PI);

    out.push({
      center: { x: cx, y: cy },
      score: d.score,
      radiusPx,
      sourceDetectionIndex: i,
    });
  }

  out.sort((a, b) => b.score - a.score);
  if (out.length > maxPins) out.length = maxPins;
  return out;
}

/**
 * Auto-calibration using board mask (class 11) + hinge bbox (class 12).
 *
 * 1. Extract 4 corners from board segmentation mask
 * 2. Use hinge to determine which edge is "top"
 * 3. Compute perspective homography mapping pixel -> board-space
 */

import { BOARD_CLASS_ID, HINGE_CLASS_ID } from '../constants';
import { extractContour, convexHull, simplifyToQuad } from '../math/contour';
import { computeHomography } from '../math/homography';
import type { Detection, CalibrationResult } from '../types';

/** Board-space corners: [topLeft, topRight, bottomRight, bottomLeft] */
const BOARD_SPACE_CORNERS: readonly [number, number][] = [
  [-7.9, -7.9],
  [7.9, -7.9],
  [7.9, 7.9],
  [-7.9, 7.9],
];

function dist2(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

function edgeMidpoint(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Order corners so that the top edge (closest to hinge) maps to
 * [topLeft, topRight, bottomRight, bottomLeft].
 */
function orderCornersUsingHinge(
  corners: [number, number][],
  hingeBbox: [number, number, number, number],
): [number, number][] {
  const hingeCx = (hingeBbox[0] + hingeBbox[2]) / 2;
  const hingeCy = (hingeBbox[1] + hingeBbox[3]) / 2;
  const hingeCenter: [number, number] = [hingeCx, hingeCy];

  // Find which edge of the quad is closest to the hinge center
  const edges: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const mid = edgeMidpoint(corners[i], corners[(i + 1) % 4]);
    edges.push(mid);
  }

  let topEdgeIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = dist2(edges[i], hingeCenter);
    if (d < minDist) { minDist = d; topEdgeIdx = i; }
  }

  // The top edge goes from corners[topEdgeIdx] to corners[(topEdgeIdx+1)%4]
  // Ensure left-to-right ordering of top edge
  const tl = corners[topEdgeIdx];
  const tr = corners[(topEdgeIdx + 1) % 4];
  const br = corners[(topEdgeIdx + 2) % 4];
  const bl = corners[(topEdgeIdx + 3) % 4];

  // If tl is to the right of tr, swap them (and also swap bl/br)
  if (tl[0] > tr[0]) {
    return [tr, tl, bl, br];
  }
  return [tl, tr, br, bl];
}

/** Fallback: order corners by image position (top of image = top of board) */
function orderCornersDefault(corners: [number, number][]): [number, number][] {
  // Sort by y to split top/bottom pairs
  const sorted = [...corners].sort((a, b) => a[1] - b[1]);
  const topPair = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bottomPair = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [topPair[0], topPair[1], bottomPair[1], bottomPair[0]];
}

export function autocalibrate(detections: Detection[]): CalibrationResult | null {
  const boardDet = detections.find(d => d.classId === BOARD_CLASS_ID);
  const hingeDet = detections.find(d => d.classId === HINGE_CLASS_ID);

  if (!boardDet?.mask) return null;

  // Step 1: Extract 4 corners from board mask
  const contourPoints = extractContour(boardDet.mask);
  if (contourPoints.length < 4) return null;

  const hull = convexHull(contourPoints);
  const quad = simplifyToQuad(hull);
  if (!quad) return null;

  // Step 2: Order corners using hinge (or fallback)
  const ordered = hingeDet
    ? orderCornersUsingHinge(quad, hingeDet.bbox)
    : orderCornersDefault(quad);

  // Step 3: Compute homography
  try {
    const H = computeHomography(ordered, BOARD_SPACE_CORNERS);
    return { H, boardCorners: ordered, confidence: boardDet.confidence };
  } catch {
    return null;
  }
}

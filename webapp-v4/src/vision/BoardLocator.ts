import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";
import {
  CLASS_BOARD,
  CLASS_HINGE,
} from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { computeHomography } from "./HomographyComputer";
import { computeConvexHull } from "../inference/postprocessing";
import type { CalibratedBoardRef } from "./visionTypes";

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Inset fractions that trim the detected board outline down to the
 * playable grid area. The board mask includes the outer plastic frame
 * and (at the top) the full hinge bar, so we need to remove them.
 *
 * All values are fractions of the detected board dimension:
 *   topRatio    — fraction of board height trimmed at the top (hinge + frame)
 *   sideRatio   — fraction of board width trimmed at each side
 *   bottomRatio — fraction of board height trimmed at the bottom
 */
export interface BoardLocateConfig {
  topRatio: number;
  sideRatio: number;
  bottomRatio: number;
}

export const DEFAULT_LOCATE_CONFIG: BoardLocateConfig = {
  topRatio: 0.1,
  sideRatio: 0.03,
  bottomRatio: 0.03,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_CONFIDENCE_THRESHOLD = 0.3;
const HINGE_CONFIDENCE_THRESHOLD = 0.3;

const BOARD_DST_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 0],
  [BOARD_WIDTH - 1, 0],
  [BOARD_WIDTH - 1, BOARD_HEIGHT - 1],
  [0, BOARD_HEIGHT - 1],
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-9 ? [v[0] / len, v[1] / len] : [0, 0];
}

/**
 * Extracts four board corners from a convex hull using diagonal extremes.
 * Stable for near-square boards and avoids the midpoint collapse that can
 * happen with axis-aligned extreme selection.
 */
function cornersFromHullDiagonalExtremes(
  points: [number, number][],
): [[number, number], [number, number], [number, number], [number, number]] | null {
  if (points.length < 4) return null;

  let tl = points[0];
  let tr = points[0];
  let br = points[0];
  let bl = points[0];

  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const [x, y] of points) {
    const sum = x + y;
    const diff = x - y;
    if (sum < minSum) { minSum = sum; tl = [x, y]; }
    if (sum > maxSum) { maxSum = sum; br = [x, y]; }
    if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
    if (diff < minDiff) { minDiff = diff; bl = [x, y]; }
  }

  const corners: [[number, number], [number, number], [number, number], [number, number]] = [tl, tr, br, bl];
  const unique = new Set(corners.map(([x, y]) => `${x.toFixed(3)}:${y.toFixed(3)}`));
  return unique.size === 4 ? corners : null;
}

/**
 * Orders 4 corners as [TL, TR, BR, BL] with the hinge-at-top constraint.
 * Top two corners = smallest y values, bottom two = largest y values.
 * Within each pair, left/right determined by x.
 */
function orderCornersHingeTop(
  corners: [number, number][],
): [[number, number], [number, number], [number, number], [number, number]] {
  const sorted = [...corners].sort((a, b) => a[1] - b[1]);
  const topPair = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const botPair = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [topPair[0], topPair[1], botPair[1], botPair[0]];
}

/**
 * Insets four ordered corners [TL, TR, BR, BL] toward the playable board area.
 *
 * Each corner is shifted along the two board edges that meet at that corner,
 * NOT axis-aligned. This means a tilted board produces a correctly-aligned
 * inset quadrilateral rather than a sheared one.
 *
 * TL: move sideInset toward TR  +  topInset toward BL
 * TR: move sideInset toward TL  +  topInset toward BR
 * BR: move sideInset toward BL  +  bottomInset toward TR
 * BL: move sideInset toward BR  +  bottomInset toward TL
 */
function insetCornersForPlayableArea(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  config: BoardLocateConfig,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [TL, TR, BR, BL] = corners;

  const topWidth = Math.hypot(TR[0] - TL[0], TR[1] - TL[1]);
  const bottomWidth = Math.hypot(BR[0] - BL[0], BR[1] - BL[1]);
  const leftHeight = Math.hypot(BL[0] - TL[0], BL[1] - TL[1]);
  const rightHeight = Math.hypot(BR[0] - TR[0], BR[1] - TR[1]);

  const avgWidth = (topWidth + bottomWidth) / 2;
  const avgHeight = (leftHeight + rightHeight) / 2;

  const side = avgWidth * config.sideRatio;
  const top = avgHeight * config.topRatio;
  const bot = avgHeight * config.bottomRatio;

  // Unit vectors along each edge, pointing inward from each corner's perspective
  const tlToTr = normalize([TR[0] - TL[0], TR[1] - TL[1]]);
  const tlToBl = normalize([BL[0] - TL[0], BL[1] - TL[1]]);
  const trToTl = normalize([TL[0] - TR[0], TL[1] - TR[1]]);
  const trToBr = normalize([BR[0] - TR[0], BR[1] - TR[1]]);
  const brToBl = normalize([BL[0] - BR[0], BL[1] - BR[1]]);
  const brToTr = normalize([TR[0] - BR[0], TR[1] - BR[1]]);
  const blToBr = normalize([BR[0] - BL[0], BR[1] - BL[1]]);
  const blToTl = normalize([TL[0] - BL[0], TL[1] - BL[1]]);

  return [
    [TL[0] + side * tlToTr[0] + top * tlToBl[0],  TL[1] + side * tlToTr[1] + top * tlToBl[1]],
    [TR[0] + side * trToTl[0] + top * trToBr[0],  TR[1] + side * trToTl[1] + top * trToBr[1]],
    [BR[0] + side * brToBl[0] + bot * brToTr[0],  BR[1] + side * brToBl[1] + bot * brToTr[1]],
    [BL[0] + side * blToBr[0] + bot * blToTl[0],  BL[1] + side * blToBr[1] + bot * blToTl[1]],
  ];
}

function clampOrderedCorners(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  imageW: number,
  imageH: number,
): {
  corners: [[number, number], [number, number], [number, number], [number, number]];
  cornersClipped: boolean;
} {
  let cornersClipped = false;
  const clamp = (c: [number, number]): [number, number] => {
    const cx = Math.max(0, Math.min(imageW - 1, c[0]));
    const cy = Math.max(0, Math.min(imageH - 1, c[1]));
    if (cx !== c[0] || cy !== c[1]) cornersClipped = true;
    return [cx, cy];
  };
  const [TL, TR, BR, BL] = corners;
  return { corners: [clamp(TL), clamp(TR), clamp(BR), clamp(BL)], cornersClipped };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Locates the board and returns a calibrated board reference with homography.
 *
 * Assumes: the hinge is always at the top of the image (no rotation scoring).
 * The inset config trims the detected outer frame down to the playable grid.
 *
 * @param detections  All YOLO detections from the first inference pass.
 * @param imageW      Original image width (for corner clamping).
 * @param imageH      Original image height (for corner clamping).
 * @param config      Inset ratios for playable area trimming.
 */
export function locateBoard(
  detections: RawDetection[],
  imageW: number,
  imageH: number,
  config: BoardLocateConfig = DEFAULT_LOCATE_CONFIG,
): CalibratedBoardRef | null {
  // 1. Highest-confidence board detection.
  const boardDet = detections
    .filter((d) => d.classId === CLASS_BOARD)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (!boardDet || boardDet.confidence < BOARD_CONFIDENCE_THRESHOLD) return null;

  // 2. Convex hull of board mask polygon.
  const hull = boardDet.maskPolygon.length >= 4
    ? computeConvexHull(boardDet.maskPolygon)
    : boardDet.maskPolygon;

  // 3. Extract 4 raw corners.
  let rawCorners: [number, number][];
  let source: string;

  if (hull.length >= 4) {
    const corners = cornersFromHullDiagonalExtremes(hull);
    if (corners) {
      rawCorners = corners;
      source = "mask_diagonal_extremes";
    } else {
      const [x1, y1, x2, y2] = boardDet.bbox;
      rawCorners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      source = "bbox";
    }
  } else {
    const [x1, y1, x2, y2] = boardDet.bbox;
    rawCorners = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    source = "bbox";
  }

  // 4. Order corners for hinge-at-top.
  const ordered = orderCornersHingeTop(rawCorners);
  let TL = ordered[0];
  let TR = ordered[1];
  const BR = ordered[2];
  const BL = ordered[3];

  // 5. Optionally snap top edge using detected hinge bbox.
  let hingeSnapped = false;
  const hingeDet = detections
    .filter((d) => d.classId === CLASS_HINGE)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (hingeDet && hingeDet.confidence >= HINGE_CONFIDENCE_THRESHOLD) {
    const hingeBottom = hingeDet.bbox[3];
    TL = [TL[0], hingeBottom];
    TR = [TR[0], hingeBottom];
    hingeSnapped = true;
  }

  // 6. Apply single inset to get playable grid corners.
  const baseCorners: [[number, number], [number, number], [number, number], [number, number]] =
    [TL, TR, BR, BL];
  const insetCorners = insetCornersForPlayableArea(baseCorners, config);
  const { corners: boardCorners, cornersClipped } = clampOrderedCorners(insetCorners, imageW, imageH);

  // 7. Compute homography: image pixels → board grid [0..13]×[0..13].
  let H: number[][];
  try {
    H = computeHomography(boardCorners, BOARD_DST_CORNERS);
  } catch {
    return null;
  }

  return {
    boardPolygon: hull,
    boardCorners,
    homographyMatrix: H,
    boardConfidence: boardDet.confidence,
    boardCornerSource: source,
    hingeSnapped,
    cornersClipped,
  };
}

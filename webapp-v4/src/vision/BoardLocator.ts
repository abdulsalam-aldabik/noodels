import {
  CLASS_BOARD,
  CLASS_HINGE,
} from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { computeHomography } from "./HomographyComputer";
import { computeConvexHull } from "../inference/postprocessing";
import type { CalibratedBoardRef } from "./visionTypes";
import { getBoardEdgeCorners } from "../board/gridGeometry";

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
  topRatio: 0.062,
  sideRatio: 0.03,
  bottomRatio: 0.03,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_CONFIDENCE_THRESHOLD = 0.3;
const HINGE_CONFIDENCE_THRESHOLD = 0.3;
const CORNER_SCORE_EPS = 1e-6;

const BOARD_DST_CORNERS = getBoardEdgeCorners();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(v: [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-9 ? [v[0] / len, v[1] / len] : [0, 0];
}

function edgeLength(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function polygonArea(corners: [[number, number], [number, number], [number, number], [number, number]]): number {
  let area = 0;
  for (let i = 0; i < corners.length; i++) {
    const [x1, y1] = corners[i];
    const [x2, y2] = corners[(i + 1) % corners.length];
    area += x1 * y2 - y1 * x2;
  }
  return Math.abs(area) * 0.5;
}

function cornerAngleDeg(
  prev: [number, number],
  curr: [number, number],
  next: [number, number],
): number {
  const v1: [number, number] = [prev[0] - curr[0], prev[1] - curr[1]];
  const v2: [number, number] = [next[0] - curr[0], next[1] - curr[1]];
  const len1 = Math.hypot(v1[0], v1[1]);
  const len2 = Math.hypot(v2[0], v2[1]);
  if (len1 < 1e-9 || len2 < 1e-9) return 0;
  const dot = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function boardCornerQualityScore(
  corners: [[number, number], [number, number], [number, number], [number, number]],
): number {
  const [tl, tr, br, bl] = corners;
  const top = edgeLength(tl, tr);
  const right = edgeLength(tr, br);
  const bottom = edgeLength(br, bl);
  const left = edgeLength(bl, tl);

  const meanSide = (top + right + bottom + left) / 4;
  if (!Number.isFinite(meanSide) || meanSide < 1e-6) return -Infinity;

  const sideError =
    (Math.abs(top - bottom) + Math.abs(left - right)) /
    (2 * meanSide);

  const angleTl = cornerAngleDeg(bl, tl, tr);
  const angleTr = cornerAngleDeg(tl, tr, br);
  const angleBr = cornerAngleDeg(tr, br, bl);
  const angleBl = cornerAngleDeg(br, bl, tl);
  const angleError =
    (Math.abs(angleTl - 90) + Math.abs(angleTr - 90) + Math.abs(angleBr - 90) + Math.abs(angleBl - 90)) /
    (4 * 90);

  const area = polygonArea(corners);
  const normalizedArea = area / (meanSide * meanSide);

  // Higher is better: larger stable quad, lower opposite-edge mismatch, lower angle skew.
  return normalizedArea - sideError * 1.8 - angleError * 1.5;
}

function tieBreakSource(source: string): number {
  if (source === "mask_diagonal_extremes") return 3;
  if (source === "mask_bbox_fused") return 2;
  if (source === "bbox") return 1;
  return 0;
}

type OrderedCorners = [[number, number], [number, number], [number, number], [number, number]];

interface CornerCandidate {
  source: string;
  rawCorners: OrderedCorners;
}

interface EvaluatedCandidate {
  source: string;
  rawCorners: OrderedCorners;
  boardCorners: OrderedCorners;
  score: number;
  qualityScore: number;
  hingeSnapped: boolean;
  cornersClipped: boolean;
}

function dedupeCandidates(candidates: CornerCandidate[]): CornerCandidate[] {
  const seen = new Set<string>();
  const out: CornerCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.rawCorners
      .map(([x, y]) => `${x.toFixed(2)}:${y.toFixed(2)}`)
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
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

  const [bx1, by1, bx2, by2] = boardDet.bbox;
  const bboxCorners: OrderedCorners = [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]];

  const rawCandidates: CornerCandidate[] = [{ source: "bbox", rawCorners: bboxCorners }];
  if (hull.length >= 4) {
    const maskCorners = cornersFromHullDiagonalExtremes(hull);
    if (maskCorners) {
      rawCandidates.push({ source: "mask_diagonal_extremes", rawCorners: maskCorners });

      // Fuse mask and bbox for robustness when mask has one weak corner.
      const fused: OrderedCorners = [
        [(maskCorners[0][0] + bboxCorners[0][0]) / 2, (maskCorners[0][1] + bboxCorners[0][1]) / 2],
        [(maskCorners[1][0] + bboxCorners[1][0]) / 2, (maskCorners[1][1] + bboxCorners[1][1]) / 2],
        [(maskCorners[2][0] + bboxCorners[2][0]) / 2, (maskCorners[2][1] + bboxCorners[2][1]) / 2],
        [(maskCorners[3][0] + bboxCorners[3][0]) / 2, (maskCorners[3][1] + bboxCorners[3][1]) / 2],
      ];
      rawCandidates.push({ source: "mask_bbox_fused", rawCorners: fused });
    }
  }

  const candidates = dedupeCandidates(rawCandidates);
  if (candidates.length === 0) return null;

  // 5. Optionally snap top edge using detected hinge bbox.
  const hingeDet = detections
    .filter((d) => d.classId === CLASS_HINGE)
    .sort((a, b) => b.confidence - a.confidence)[0];

  const evaluated: EvaluatedCandidate[] = [];

  for (const candidate of candidates) {
    const ordered = orderCornersHingeTop(candidate.rawCorners);
    let TL = ordered[0];
    let TR = ordered[1];
    const BR = ordered[2];
    const BL = ordered[3];

    let hingeSnapped = false;
    if (hingeDet && hingeDet.confidence >= HINGE_CONFIDENCE_THRESHOLD) {
      const hingeBottom = hingeDet.bbox[3];
      TL = [TL[0], hingeBottom];
      TR = [TR[0], hingeBottom];
      hingeSnapped = true;
    }

    const baseCorners: OrderedCorners = [TL, TR, BR, BL];
    const insetCorners = insetCornersForPlayableArea(baseCorners, config);
    const { corners: boardCorners, cornersClipped } = clampOrderedCorners(insetCorners, imageW, imageH);

    // Source-priority scoring: mask_diagonal_extremes > mask_bbox_fused > bbox.
    // The old boardCornerQualityScore penalised non-90° angles, causing the
    // axis-aligned bbox to always win for tilted boards. We keep the quality
    // score only for debug traceability and never use it for selection.
    const SOURCE_PRIORITY: Record<string, number> = {
      mask_diagonal_extremes: 3,
      mask_bbox_fused: 2,
      bbox: 1,
    };
    const qualityScore = boardCornerQualityScore(boardCorners);
    const score = (SOURCE_PRIORITY[candidate.source] ?? 0) * 5
      + (hingeSnapped ? 0.5 : 0)
      + (cornersClipped ? -2 : 0);

    evaluated.push({
      source: candidate.source,
      rawCorners: baseCorners,
      boardCorners,
      score,
      qualityScore,
      hingeSnapped,
      cornersClipped,
    });
  }

  evaluated.sort((a, b) => {
    if (Math.abs(b.score - a.score) > CORNER_SCORE_EPS) return b.score - a.score;
    return tieBreakSource(b.source) - tieBreakSource(a.source);
  });

  const selected = evaluated[0];
  if (!selected) return null;

  // 7. Compute homography: image pixels -> board-space where playable edges are
  // [-0.5..13.5] and cell centers are integers [0..13].
  let H: number[][];
  try {
    H = computeHomography(selected.boardCorners, BOARD_DST_CORNERS);
  } catch {
    return null;
  }

  return {
    boardPolygon: hull,
    boardCorners: selected.boardCorners,
    homographyMatrix: H,
    boardConfidence: boardDet.confidence,
    boardBbox: boardDet.bbox,
    boardCornerSource: selected.source,
    boardCornerScore: selected.score,
    boardCornerCandidates: evaluated.map((candidate) => ({
      source: candidate.source,
      score: candidate.score,
      qualityScore: candidate.qualityScore,
      selected: candidate.source === selected.source,
      hingeSnapped: candidate.hingeSnapped,
      cornersClipped: candidate.cornersClipped,
      rawCorners: candidate.rawCorners,
      boardCorners: candidate.boardCorners,
    })),
    hingeSnapped: selected.hingeSnapped,
    cornersClipped: selected.cornersClipped,
  };
}

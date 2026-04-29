import {
  BOARD_CLASS_ID,
  HINGE_CLASS_ID,
  type Point2D,
  type RawDetection,
  type ImageSize,
} from "../inference/types";
import type {
  BoardRef,
  CornerCandidate,
  CornerSource,
  LocalizationStatus,
} from "./types";

type Quad = [Point2D, Point2D, Point2D, Point2D];

/** Score below which the pipeline flags the localization as low-confidence. */
export const LOW_CONFIDENCE_THRESHOLD = 0.55;

/**
 * Sample the "1" pixels of a detection mask and return their positions in
 * source-image coordinates. We stride through the mask to cap cost at a few
 * thousand points even for a large board crop.
 */
function sampleMaskPoints(detection: RawDetection, maxPoints = 3000): Point2D[] {
  const m = detection.mask;
  if (!m) return [];
  const { width: mw, height: mh, data } = m;
  const { x, y, width: bw, height: bh } = detection.bbox;

  const points: Point2D[] = [];
  // Count mask=1 first so we can uniformly stride.
  let ones = 0;
  for (let i = 0; i < data.length; i++) ones += data[i];
  if (ones === 0) return [];
  const stride = Math.max(1, Math.floor(ones / maxPoints));

  const sx = bw / mw;
  const sy = bh / mh;
  let seen = 0;
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      if (data[my * mw + mx] === 0) continue;
      seen++;
      if (seen % stride !== 0) continue;
      points.push({ x: x + (mx + 0.5) * sx, y: y + (my + 0.5) * sy });
    }
  }
  return points;
}

/** Andrew's monotone chain convex hull. */
function convexHull(points: Point2D[]): Point2D[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2D[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function distance(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Order a quad into TL, TR, BR, BL by angle around the centroid. */
function orderQuad(q: Point2D[]): Quad {
  if (q.length !== 4) throw new Error("orderQuad: expected 4 points");
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const withAngle = q.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) }));
  withAngle.sort((a, b) => a.a - b.a);
  // After sort, points are CCW around centroid starting near -π (upper-left).
  // Rotate so index 0 is the point with smallest (x+y) — i.e., TL.
  const sorted = withAngle.map((w) => w.p);
  let tlIdx = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const s = sorted[i].x + sorted[i].y;
    if (s < best) {
      best = s;
      tlIdx = i;
    }
  }
  const rotated: Point2D[] = [
    sorted[tlIdx],
    sorted[(tlIdx + 1) % 4],
    sorted[(tlIdx + 2) % 4],
    sorted[(tlIdx + 3) % 4],
  ];
  // Check CCW vs CW: we want TL, TR, BR, BL → CW in image coords.
  const cross =
    (rotated[1].x - rotated[0].x) * (rotated[2].y - rotated[0].y) -
    (rotated[1].y - rotated[0].y) * (rotated[2].x - rotated[0].x);
  if (cross < 0) {
    // CCW → reverse last three so we end up CW.
    return [rotated[0], rotated[3], rotated[2], rotated[1]];
  }
  return [rotated[0], rotated[1], rotated[2], rotated[3]];
}

// ---------- Candidate generators ----------

function candidateHullDiagonalExtremes(hull: Point2D[]): Quad | null {
  if (hull.length < 4) return null;
  let tl = hull[0], tr = hull[0], br = hull[0], bl = hull[0];
  let tlS = Infinity, brS = -Infinity, trS = -Infinity, blS = Infinity;
  for (const p of hull) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < tlS) { tlS = sum; tl = p; }
    if (sum > brS) { brS = sum; br = p; }
    if (diff > trS) { trS = diff; tr = p; }
    if (diff < blS) { blS = diff; bl = p; }
  }
  return orderQuad([tl, tr, br, bl]);
}

function candidateBboxFused(hull: Point2D[]): Quad | null {
  if (hull.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of hull) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Refine each side: pick the hull point closest to each AABB edge midpoint.
  const topMid = { x: (minX + maxX) / 2, y: minY };
  const botMid = { x: (minX + maxX) / 2, y: maxY };
  const leftMid = { x: minX, y: (minY + maxY) / 2 };
  const rightMid = { x: maxX, y: (minY + maxY) / 2 };
  void topMid; void botMid; void leftMid; void rightMid;
  return orderQuad([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]);
}

function candidateFallbackBbox(detection: RawDetection): Quad {
  const b = detection.bbox;
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
}

// ---------- Scoring ----------

function scoreCandidate(
  corners: Quad,
  hullArea: number,
  hingeCenter: Point2D | null,
): {
  score: number;
  subScores: CornerCandidate["subScores"];
} {
  const quadArea = polygonArea(corners);
  const rectangularity = hullArea > 0 ? Math.min(1, quadArea / hullArea) : 0;

  const topWidth = distance(corners[0], corners[1]);
  const bottomWidth = distance(corners[3], corners[2]);
  const leftHeight = distance(corners[0], corners[3]);
  const rightHeight = distance(corners[1], corners[2]);
  const avgW = (topWidth + bottomWidth) / 2;
  const avgH = (leftHeight + rightHeight) / 2;
  const aspect = avgW > 0 && avgH > 0
    ? 1 - Math.min(1, Math.abs(1 - Math.min(avgW, avgH) / Math.max(avgW, avgH)))
    : 0;
  const sideBalance =
    avgW > 0 && avgH > 0
      ? 1 - Math.min(1, Math.abs(topWidth - bottomWidth) / avgW)
            * 0.5 - Math.min(1, Math.abs(leftHeight - rightHeight) / avgH) * 0.5
      : 0;

  let hingeAlignment = 0.5; // Neutral when no hinge.
  if (hingeCenter) {
    const topEdgeMid = {
      x: (corners[0].x + corners[1].x) / 2,
      y: (corners[0].y + corners[1].y) / 2,
    };
    const d = distance(topEdgeMid, hingeCenter);
    const denom = Math.max(1, topWidth);
    hingeAlignment = Math.max(0, 1 - d / denom);
  }

  const score =
    0.4 * rectangularity +
    0.25 * aspect +
    0.2 * sideBalance +
    0.15 * hingeAlignment;

  return {
    score,
    subScores: {
      rectangularity,
      aspect,
      edgeContrast: sideBalance, // repurposed: we use side-balance as a proxy for now
      hingeAlignment,
    },
  };
}

// ---------- Public entrypoint ----------

export interface LocateOptions {
  lowConfidenceThreshold?: number;
}

export function locateBoard(
  detections: RawDetection[],
  imageSize: ImageSize,
  options: LocateOptions = {},
): BoardRef {
  const threshold = options.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;

  const boardDets = detections
    .filter((d) => d.classId === BOARD_CLASS_ID)
    .sort((a, b) => b.score - a.score);

  if (boardDets.length === 0) {
    return makeFailedRef(imageSize, "no board detection");
  }

  const board = boardDets[0];
  const points = sampleMaskPoints(board);
  const hull = points.length >= 3
    ? convexHull(points)
    : [
        { x: board.bbox.x, y: board.bbox.y },
        { x: board.bbox.x + board.bbox.width, y: board.bbox.y },
        { x: board.bbox.x + board.bbox.width, y: board.bbox.y + board.bbox.height },
        { x: board.bbox.x, y: board.bbox.y + board.bbox.height },
      ];
  const hullArea = polygonArea(hull);

  const hingeDet = detections
    .filter((d) => d.classId === HINGE_CLASS_ID)
    .sort((a, b) => b.score - a.score)[0];
  const hingeCenter: Point2D | null = hingeDet
    ? {
        x: hingeDet.bbox.x + hingeDet.bbox.width / 2,
        y: hingeDet.bbox.y + hingeDet.bbox.height / 2,
      }
    : null;
  const hingeFound = Boolean(hingeDet);

  const generators: Array<{ source: CornerSource; quad: Quad | null }> = [
    { source: "hull_diagonal_extremes", quad: candidateHullDiagonalExtremes(hull) },
    { source: "bbox_fused", quad: candidateBboxFused(hull) },
    { source: "fallback_bbox", quad: candidateFallbackBbox(board) },
  ];

  const candidates: CornerCandidate[] = [];
  for (const g of generators) {
    if (!g.quad) continue;
    const { score, subScores } = scoreCandidate(g.quad, hullArea, hingeCenter);
    candidates.push({
      source: g.source,
      corners: g.quad,
      score,
      subScores,
    });
  }

  if (candidates.length === 0) {
    return makeFailedRef(imageSize, "all candidate generators failed");
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const status: LocalizationStatus = winner.score >= threshold ? "ok" : "lowConfidence";

  return {
    imageSize,
    corners: winner.corners,
    cornerSource: winner.source,
    cornerScore: winner.score,
    candidates,
    hingeFound,
    hingePolygon: hingeDet
      ? [
          { x: hingeDet.bbox.x, y: hingeDet.bbox.y },
          { x: hingeDet.bbox.x + hingeDet.bbox.width, y: hingeDet.bbox.y },
          {
            x: hingeDet.bbox.x + hingeDet.bbox.width,
            y: hingeDet.bbox.y + hingeDet.bbox.height,
          },
          { x: hingeDet.bbox.x, y: hingeDet.bbox.y + hingeDet.bbox.height },
        ]
      : undefined,
    status,
    message: status === "lowConfidence" ? "winning corner score below threshold" : undefined,
  };
}

function makeFailedRef(imageSize: ImageSize, message: string): BoardRef {
  return {
    imageSize,
    corners: [
      { x: 0, y: 0 },
      { x: imageSize.width, y: 0 },
      { x: imageSize.width, y: imageSize.height },
      { x: 0, y: imageSize.height },
    ],
    cornerSource: "fallback_bbox",
    cornerScore: 0,
    candidates: [],
    hingeFound: false,
    status: "failed",
    message,
  };
}

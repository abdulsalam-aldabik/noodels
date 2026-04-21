/**
 * Extract the two rope endpoints of a piece-class detection, in board-space units.
 *
 * Pieces are long, thin curves. Their 2D mask, once warped into board space,
 * is well-approximated by its principal component:
 *   - sample mask pixels in board space,
 *   - run 2-D PCA,
 *   - project every sample onto the first eigenvector,
 *   - take the two extrema as the rope endpoints.
 *
 * When the first/second eigenvalue ratio is too close (curled / L-shaped pieces
 * like G, J, B, H) the PCA axis is ambiguous, so we fall back to the
 * farthest-pair heuristic: the two mask samples with the greatest pairwise
 * Euclidean distance (O(n·k) sub-sampled for perf).
 */

import type { Point2D } from "../inference/types";
import type { RawDetection } from "../inference/types";
import { applyHomography } from "./Rectifier";
import type { PinEndpointAssignment } from "./types";

/** PCA first/second eigenvalue ratio below this triggers the farthest-pair fallback. */
const PCA_ECCENTRICITY_FLOOR = 2.0;
/** Max board-space mask samples we process per detection. */
const MASK_SAMPLE_CAP = 600;

export interface ExtractOptions {
  maxSamples?: number;
  pcaFloor?: number;
}

export interface ExtractResult {
  /** Two board-space points ordered so that endpoints[0].y ≤ endpoints[1].y (stable ordering). */
  endpoints: [Point2D, Point2D] | null;
  /** Eigenvalue ratio (λ1/λ2). Used upstream to gate trust; <pcaFloor → fallback branch ran. */
  eigenRatio: number;
  /** Board-space sample points used by the extraction (for telemetry/debug). */
  boardSamples: Point2D[];
}

/**
 * Warp a detection mask to board space and extract its endpoints.
 * `imgToBoard` must be the forward homography image-px → board-space.
 */
export function extractPieceEndpoints(
  detection: RawDetection,
  imgToBoard: number[],
  options: ExtractOptions = {},
): ExtractResult {
  const maxSamples = options.maxSamples ?? MASK_SAMPLE_CAP;
  const pcaFloor = options.pcaFloor ?? PCA_ECCENTRICITY_FLOOR;

  const samples = warpMaskToBoard(detection, imgToBoard, maxSamples);
  if (samples.length < 4) {
    return { endpoints: null, eigenRatio: 0, boardSamples: samples };
  }

  const pca = pca2D(samples);
  let endpoints: [Point2D, Point2D];

  if (pca.eigenRatio >= pcaFloor) {
    endpoints = pcaExtremaEndpoints(samples, pca.mean, pca.axis);
  } else {
    endpoints = farthestPair(samples);
  }

  // Stable ordering: endpoints[0] is whichever has lower y (ties broken by x).
  if (
    endpoints[0].y > endpoints[1].y ||
    (endpoints[0].y === endpoints[1].y && endpoints[0].x > endpoints[1].x)
  ) {
    endpoints = [endpoints[1], endpoints[0]];
  }
  return { endpoints, eigenRatio: pca.eigenRatio, boardSamples: samples };
}

/** Assemble a PinEndpointAssignment skeleton for one detection; endpoints unsnapped. */
export function toUnsnappedAssignment(
  detection: RawDetection,
  sourceDetectionIndex: number,
  result: ExtractResult,
): Pick<PinEndpointAssignment, "classId" | "className" | "sourceDetectionIndex" | "endpoints" | "pcaEigenRatio"> {
  return {
    classId: detection.classId,
    className: detection.className,
    sourceDetectionIndex,
    endpoints: result.endpoints,
    pcaEigenRatio: result.eigenRatio,
  };
}

// ---------- Internals ----------

function warpMaskToBoard(
  d: RawDetection,
  imgToBoard: number[],
  maxSamples: number,
): Point2D[] {
  const m = d.mask;
  if (!m) {
    // Fallback: use bbox corners + center as a coarse stand-in.
    const { x, y, width, height } = d.bbox;
    const corners: Point2D[] = [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
      { x: x + width / 2, y: y + height / 2 },
    ];
    return corners.map((p) => applyHomography(imgToBoard, p.x, p.y));
  }

  const { width: mw, height: mh, data } = m;
  const { x: bx, y: by, width: bw, height: bh } = d.bbox;
  const sx = bw / mw;
  const sy = bh / mh;

  // Count live pixels to decide stride.
  let ones = 0;
  for (let i = 0; i < data.length; i++) ones += data[i];
  if (ones === 0) return [];
  const stride = Math.max(1, Math.floor(ones / maxSamples));

  const out: Point2D[] = [];
  let seen = 0;
  for (let my = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++) {
      if (data[my * mw + mx] === 0) continue;
      seen++;
      if (seen % stride !== 0) continue;
      const imgX = bx + (mx + 0.5) * sx;
      const imgY = by + (my + 0.5) * sy;
      out.push(applyHomography(imgToBoard, imgX, imgY));
    }
  }
  return out;
}

interface PCA2DResult {
  mean: Point2D;
  axis: Point2D; // unit vector along first principal component
  eigenRatio: number;
}

function pca2D(points: Point2D[]): PCA2DResult {
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const n = points.length;
  const mx = sumX / n;
  const my = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= n;
  sxy /= n;
  syy /= n;

  // 2×2 symmetric eigen-decomposition.
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (trace * trace) / 4 - det);
  const sqrtDisc = Math.sqrt(disc);
  const lam1 = trace / 2 + sqrtDisc;
  const lam2 = trace / 2 - sqrtDisc;

  let ax: number;
  let ay: number;
  if (Math.abs(sxy) > 1e-9) {
    ax = lam1 - syy;
    ay = sxy;
  } else if (sxx >= syy) {
    ax = 1;
    ay = 0;
  } else {
    ax = 0;
    ay = 1;
  }
  const norm = Math.hypot(ax, ay) || 1;
  const axis = { x: ax / norm, y: ay / norm };

  const eigenRatio =
    Math.abs(lam2) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(lam1 / lam2);

  return { mean: { x: mx, y: my }, axis, eigenRatio };
}

function pcaExtremaEndpoints(points: Point2D[], mean: Point2D, axis: Point2D): [Point2D, Point2D] {
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  let minP: Point2D = points[0];
  let maxP: Point2D = points[0];
  for (const p of points) {
    const t = (p.x - mean.x) * axis.x + (p.y - mean.y) * axis.y;
    if (t < minT) {
      minT = t;
      minP = p;
    }
    if (t > maxT) {
      maxT = t;
      maxP = p;
    }
  }
  return [minP, maxP];
}

function farthestPair(points: Point2D[]): [Point2D, Point2D] {
  // Two-pass heuristic: pick the point farthest from the centroid (A), then
  // the point farthest from A. O(n) and accurate for long thin blobs.
  let sumX = 0;
  let sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const centroid: Point2D = { x: sumX / points.length, y: sumY / points.length };

  let a = points[0];
  let bestA = -1;
  for (const p of points) {
    const d = Math.hypot(p.x - centroid.x, p.y - centroid.y);
    if (d > bestA) {
      bestA = d;
      a = p;
    }
  }

  let b = a;
  let bestB = -1;
  for (const p of points) {
    const d = Math.hypot(p.x - a.x, p.y - a.y);
    if (d > bestB) {
      bestB = d;
      b = p;
    }
  }
  return [a, b];
}
